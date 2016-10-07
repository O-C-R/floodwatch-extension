// @flow
// Inspired by: https://github.com/bltfirefox/easylist-filter, under MPL 2.0

import $ from 'jquery';

const RULE_OPTION_TYPES = {
  'IMAGE': 'image',
  'STYLESHEET': 'stylesheet',
  'SCRIPT': 'script',
  'OBJECT': 'object',
  'SUBDOCUMENT': 'subdocument'
};

type RuleOptions = {
  typeMaskDefault?: boolean;
  typeMask?: { [key: string]: boolean };
  domains?: Array<{ negates: boolean, regexp: RegExp }>;
  thirdParty?: boolean;
};

class Rule {
  raw: string;
  url: string;
  urlRegex: RegExp;
  options: RuleOptions;

  static isWhite(raw) {
    return Rule.isRule(raw) && raw.indexOf('@@') === 0;
  }

  static isBlack(raw) {
    return Rule.isRule(raw) && raw.charAt(0) !== '!';
  }

  static isRule(raw) {
    return ! Rule.isElementSelector(raw) && raw.indexOf('#@#') === -1;
  }

  static isElementSelector(raw) {
    return raw.indexOf('##') === 0;
  }

  constructor(raw: string) {
    this.raw = raw;
    this._parse();
  }

  matchesUrl(url: string) {
    return this.urlRegex.test(url);
  }

  includesType(mediaType: string): boolean {
    const optionType = RULE_OPTION_TYPES[mediaType];
    if (!optionType) return true;

    if (this.options.typeMask) {
      const included: ?boolean = this.options.typeMask[optionType];
      if (this.options.typeMaskDefault !== undefined) {
        return included === undefined ? this.options.typeMaskDefault : included === true;
      } else {
        return included === true;
      }
    } else {
      return true;
    }
  }

  matchesDomain(hostname: string): boolean {
    if (!this.options.domains) return false;

    for (const domain of this.options.domains) {
      if (!domain.regexp.test(hostname)) continue;
      return !domain.negates;
    }

    return false;
  }

  hasDomains(): boolean {
    return this.options.domains !== undefined && this.options.domains.length > 0;
  }

  hasOptions(): boolean {
    return Object.keys(this.options).length > 0;
  }

  _parse() {
    const parts = this.raw.split('$');

    this.url = parts[0];
    this.urlRegex = ruleToRegExp(this.url);

    if (parts.length < 2) {
      this.options = {};
      return;
    }

    const rawOptions = parts[1].split(',');
    const possibleTypes = ['script', 'image', 'stylesheet', 'object', 'object-subrequest', 'subdocument'];
    const options: RuleOptions = {
      typeMaskDefault: true,
      typeMask: {},
      domains: [],
      thirdParty: undefined
    };

    for (const option of rawOptions) {
      const isDomainOption = option.indexOf('domain=') >= 0;
      if (isDomainOption) {
        options.domains = option
          .replace('domain=', '')
          .split('|')
          .map(function(d: string) {
            const negative = d.charAt(0) === '~';
            return {
              negates: negative,
              regexp: ruleToRegExp(negative ? d.slice(1) : d)
            };
          });
        continue;
      }

      const isTypeOption = possibleTypes.some(function(t: string) {
        return option === t || option === '~' + t;
      });
      if (isTypeOption) {
        const optionPos = option.charAt(0) !== '~';
        const optionVal = optionPos ? option : option.slice(1);

        if (!options.typeMask) { options.typeMask = {}; }
        options.typeMaskDefault = false;
        options.typeMask[optionVal] = optionPos;

        continue;
      }

      if (option === 'third-party') {
        options.thirdParty = true;
        continue;
      }
      if (option === '~third-party') {
        options.thirdParty = false;
        continue;
      }

    }

    this.options = options;
  }
}

// based on https://github.com/bltfirefox/easylist-filter, under MPL 2.0
let filterSingleton: ?Filter = null;
export class Filter {
  whitelist: Array<Rule>;
  blacklist: Array<Rule>;
  elementBlacklist: string[];
  elementBlacklistSelector: string;

  static get(): Filter {
    if (!filterSingleton) {
      filterSingleton = new Filter();
    }

    return filterSingleton;
  }

  constructor() {
    this.resetRules();
  }

  resetRules() {
    this.whitelist = [];
    this.blacklist = [];
    this.elementBlacklist = [];
    this.elementBlacklistSelector = '';
  }

  addRulesFromUrl(url: string): Promise<void> {
    return fetch(url)
      .then((res) => res.text())
      .then((body) => this.addRulesFromText(body));
  }

  addRulesFromText(text: string): void {
    const lines = text.split('\n');
    const whitelist = [];
    const blacklist = [];
    const elementBlacklist = [];

    // divides easy list into blacklist and exceptions in blacklist (whitelist)
    for (let line of lines) {
      if (Rule.isElementSelector(line)) {
        line = line.slice(2);
        elementBlacklist.push(line);
      } else if (Rule.isWhite(line)) {
        line = line.slice(2);
        whitelist.push(new Rule(line));
      } else if (Rule.isBlack(line)) {
        blacklist.push(new Rule(line));
      }
    }

    this.whitelist.push(...whitelist);
    this.blacklist.push(...blacklist);
    this.elementBlacklist.push(...elementBlacklist);

    const newSelector = elementBlacklist.join(',');
    if (newSelector.length > 0) {
      this.elementBlacklistSelector = this.elementBlacklistSelector.length > 0 ?
        [this.elementBlacklistSelector, newSelector].join(',') : newSelector;
    }
  }

  static matchingUrls(mediaType: string, url: string, topUrl: string, rules: Array<Rule>): Rule | null {
    for (const rule of rules) {
      if (!rule.matchesUrl(url)) {
        continue;
      }

      // If there are no additional options and the url matches the rule, return true.
      if (!rule.hasOptions()) {
        return rule;
      }

      if (!rule.includesType(mediaType)) {
        continue;
      }

      const topUrlObj = new URL(topUrl);
      const urlObj = new URL(url, topUrlObj.origin);
      const is3P = isThirdParty(urlObj, topUrlObj);
      if (rule.options && rule.options.thirdParty === true && !is3P) {
        continue;
      }
      if (rule.options && rule.options.thirdParty === false && is3P) {
        continue;
      }

      if (rule.hasDomains()) {
        if (rule.matchesDomain(topUrlObj.hostname)) {
          return rule;
        } else {
          continue;
        }
      }

      return rule;
    }

    return null;
  }

  isAd(adEl: { urls: string[], topUrl: string, mediaType: string, adHtml: string }): Rule | boolean | null {
    const topUrl = adEl.topUrl;
    const mediaType = adEl.mediaType;

    for (const url of adEl.urls) {
      const blacklisted = this.isBlacklistedUrl(mediaType, url, topUrl);

      if (blacklisted != null) {
        const whitelisted = this.isWhitelistedUrl(mediaType, url, topUrl);
        if (whitelisted == null) {
          return blacklisted;
        } else {
          return whitelisted;
        }
      }
    }

    // TODO: figure out if checking for blacklisted elements is worth it.
    return this.isBlacklistedElement(adEl.adHtml);
  }

  isWhitelistedUrl(mediaType: string, url: string, topUrl: string): Rule | null {
    return Filter.matchingUrls(mediaType, url, topUrl, this.whitelist);
  }

  isBlacklistedUrl(mediaType: string, url: string, topUrl: string): Rule | null {
    return Filter.matchingUrls(mediaType, url, topUrl, this.blacklist);
  }

  isBlacklistedElement(html: string): boolean {
    const nodes: Element[] = $.parseHTML(html);
    if (nodes.length == 0) return false;

    return nodes[0].matches(this.elementBlacklistSelector);
  }
}

function normalizeHostname(hn: string): string {
  return hn.split('.').slice(-2).join('.');
}

function isThirdParty(uri: URL, topURI: URL): boolean {
  const hostTop = normalizeHostname(topURI.hostname);
  const host = normalizeHostname(uri.hostname);

  return hostTop != host;
}

// With some logic from: https://github.com/scrapinghub/adblockparser/blob/master/adblockparser/parser.py
function ruleToRegExp(rule: string): RegExp {
  const debug = false;
  if (debug) {
    console.log('BEFORE:', rule);
  }

  rule = rule.replace(/[.$+?|{}()\[\]\\]/g, '\\$&');
  rule = rule.replace('^', '\($|\/|\:\)');
  rule = rule.replace('*', '\(.*\)');

  if (rule.endsWith('\\|')) {
    // End of address
    rule = rule.slice(0, rule.length-2) + '$';
  }

  if (rule.startsWith('\\|\\|')) {
    // Beginning of domain name - this is a little hacky.
    rule = '(?:\\.|://)' + rule.slice(4);
  } else if (rule.startsWith('\\|')) {
    rule = '^' + rule.slice(2);
  }

  if (debug) {
    console.log('AFTER:', rule);
  }
  return new RegExp(rule);
}
