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

type DomainList = Array<{ negates: boolean, regexp: RegExp }>;

class Rule {
  raw: string;
  domains: ?DomainList;

  static isRule(raw) {
    return raw.charAt(0) !== '!';
  }

  static isUrlRuleException(raw) {
    return raw.indexOf('@@') === 0;
  }

  static isElementRule(raw) {
    return raw.indexOf('##') >= 0;
  }

  static isElementRuleException(raw) {
    return raw.indexOf('#@#') >= 0;
  }

  constructor(raw: string) {
    this.raw = raw;
  }

  matchesDomain(hostname: string): boolean {
    if (!this.domains || this.domains.length == 0) return true;

    for (const domain of this.domains) {
      if (!domain.regexp.test(hostname)) continue;
      return !domain.negates;
    }

    return false;
  }
}

class ElementRule extends Rule {
  selector: string;

  constructor(raw: string) {
    super(raw);
    this._parse();
  }

  _parse(): void {
    const parts = this.raw.split('##');
    if (parts[0].length > 0) {
      const domainList = parts[0].split(',');
      this.domains = domainListToObjects(domainList);
    }

    this.selector = parts[1];
  }
}

class UrlRule extends Rule {
  url: string;
  urlRegex: RegExp;

  hasOptions: boolean;
  typeMaskDefault: ?boolean;
  typeMask: ?{ [key: string]: boolean };
  thirdParty: ?boolean;

  constructor(raw: string) {
    super(raw);

    this.hasOptions = false;
    this.typeMaskDefault = true;
    this.typeMask = {};
    this.thirdParty = undefined;

    this._parse();
  }

  matchesUrl(url: string) {
    return this.urlRegex.test(url);
  }

  includesType(mediaType: string): boolean {
    // This allows us to ignore some of the media types
    const optionType = RULE_OPTION_TYPES[mediaType];
    if (!optionType) return true;

    if (this.typeMask) {
      const included: ?boolean = this.typeMask[optionType];
      if (this.typeMaskDefault) {
        return included === undefined ? this.typeMaskDefault : included === true;
      } else {
        return included === true;
      }
    } else {
      return true;
    }
  }

  _parse() {
    const parts = this.raw.split('$');

    this.url = parts[0];
    this.urlRegex = ruleToRegExp(this.url);

    if (parts.length < 2) {
      return;
    }

    this.hasOptions = true;

    const rawOptions = parts[1].split(',');
    const possibleTypes = ['script', 'image', 'stylesheet', 'object', 'object-subrequest', 'subdocument'];

    for (const option of rawOptions) {
      const isDomainOption = option.indexOf('domain=') >= 0;
      if (isDomainOption) {
        const domainList = option.replace('domain=', '').split('|');
        this.domains = domainListToObjects(domainList);

        continue;
      }

      const isTypeOption = possibleTypes.some(function(t: string) {
        return option === t || option === '~' + t;
      });
      if (isTypeOption) {
        const optionPos = option.charAt(0) !== '~';
        const optionVal = optionPos ? option : option.slice(1);

        if (!this.typeMask) { this.typeMask = {}; }
        this.typeMaskDefault = false;
        this.typeMask[optionVal] = optionPos;

        continue;
      }

      if (option === 'third-party') {
        this.thirdParty = true;
        continue;
      }
      if (option === '~third-party') {
        this.thirdParty = false;
        continue;
      }
    }
  }
}

// based on https://github.com/bltfirefox/easylist-filter, under MPL 2.0
let filterSingleton: ?Filter = null;
export class Filter {
  whitelist: UrlRule[];
  blacklist: UrlRule[];
  elementBlacklist: ElementRule[];
  elementWhitelist: ElementRule[];

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
    this.elementWhitelist = [];
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
    const elementWhitelist = [];

    // divides easy list into blacklist and exceptions in blacklist (whitelist)
    for (let line of lines) {
      if (!Rule.isRule(line)) continue;

      if (Rule.isElementRule(line)) {
        if (Rule.isElementRuleException(line)) {
          elementWhitelist.push(new ElementRule(line));
        } else {
          elementBlacklist.push(new ElementRule(line));
        }
      } else if (Rule.isUrlRuleException(line)) {
        line = line.slice(2);
        whitelist.push(new UrlRule(line));
      } else {
        blacklist.push(new UrlRule(line));
      }
    }

    this.whitelist.push(...whitelist);
    this.blacklist.push(...blacklist);
    this.elementBlacklist.push(...elementBlacklist);
    this.elementWhitelist.push(...elementWhitelist);
  }

  static matchingUrls(mediaType: string, url: string, topUrl: string, rules: Array<UrlRule>): ?UrlRule {
    const topUrlObj = new URL(topUrl);
    const topUrlOrigin = topUrlObj.origin !== 'null' ? topUrlObj.origin : undefined;

    const urlObj = new URL(url, topUrlOrigin);
    const is3P = isThirdParty(urlObj, topUrlObj);

    for (const rule of rules) {
      if (rule.thirdParty === true && !is3P) {
        continue;
      } else if (rule.thirdParty === false && is3P) {
        continue;
      }

      if (!rule.matchesDomain(topUrlObj.hostname)) {
        continue;
      }

      if (!rule.includesType(mediaType)) {
        continue;
      }

      if (!rule.matchesUrl(url)) {
        continue;
      }

      return rule;
    }

    return null;
  }

  isAd({ urls, topUrl, mediaType, html }: { urls: string[], topUrl: string, mediaType: string, html: string }): ?Rule {
    // Check against url rules
    for (const url of urls) {
      const isAd = this.isUrlAd(mediaType, url, topUrl);
      if (isAd) {
        return isAd;
      }
    }

    // Check against element rules
    const isElementAd = this.isElementAd(html, topUrl);
    if (isElementAd) {
      return isElementAd;
    }

    return null;
  }

  isUrlAd(mediaType: string, url: string, topUrl: string): ?UrlRule {
    const blacklisted = Filter.matchingUrls(mediaType, url, topUrl, this.blacklist);

    if (blacklisted != null) {
      const whitelisted = Filter.matchingUrls(mediaType, url, topUrl, this.whitelist);

      if (whitelisted == null) {
        return blacklisted;
      } else {
        return whitelisted;
      }
    } else {
      return null;
    }
  }

  isElementAd(html: string, topUrl: string): ?ElementRule {
    // Generate a node but don't attach it to the DOM. We're just testing against
    // selectors.
    const nodes: Element[] = $.parseHTML(html);
    if (nodes.length == 0) {
      return null;
    }
    const el = nodes[0];

    const topUrlObj = new URL(topUrl);
    const hostname = topUrlObj.hostname;

    const blacklisted = this.findMatchingElementRule(hostname, el, this.elementBlacklist);

    if (blacklisted) {
      const whitelisted = this.findMatchingElementRule(hostname, el, this.elementWhitelist);

      if (whitelisted == null) {
        return blacklisted;
      } else {
        return whitelisted;
      }
    } else {
      return null;
    }
  }

  findMatchingElementRule(hostname: string, el: Element, rules: ElementRule[]): ?ElementRule {
    for (const rule of rules) {
      if (rule.matchesDomain(hostname)) {
        if (el.matches(rule.selector)) {
          return rule;
        }
      }
    }

    return null;
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

function domainListToObjects(domainList: string[]): DomainList  {
  return domainList.map(function(d: string) {
    const negative = d.charAt(0) === '~';
    return {
      negates: negative,
      regexp: ruleToRegExp(negative ? d.slice(1) : d)
    };
  });
}

// With some logic from: https://github.com/scrapinghub/adblockparser/blob/master/adblockparser/parser.py
function ruleToRegExp(rule: string): RegExp {
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

  return new RegExp(rule);
}
