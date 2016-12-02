// @flow

let ignoreSingleton: ?IgnorePatterns = null;
export class IgnorePatterns {
  rawPatterns: string[];
  compiledPatterns: ?RegExp;

  static get(): IgnorePatterns {
    if (!ignoreSingleton) {
      ignoreSingleton = new IgnorePatterns();
    }

    return ignoreSingleton;
  }

  constructor() {
    this.reset();
  }

  reset() {
    this.rawPatterns = [];
    this.compiledPatterns = null;
  }

  compile() {
    const pattern = this.rawPatterns.map((p: string): ?string => {
      // Ignore lines that start with "!"
      if (p.charAt(0) == '!') {
        return null;
      }

      // Replace special characters
      let escaped = p.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");

      // Replace "\*" with an actual wildcard match
      escaped = escaped.replace('\\*', '.*');

      if (escaped.length == 0) {
        return null;
      }

      return `(^${escaped}$)`;
    }).filter(p => p).join('|');

    this.compiledPatterns = new RegExp(pattern, 'i');
  }

  isIgnored(url: string): boolean {
    if (this.compiledPatterns != null) {
      try {
        const urlObj = new URL(url);
        return this.compiledPatterns.test(urlObj.hostname);
      } catch (e) {
        return false;
      }
    } else {
      return false;
    }
  }

  addMany(patterns: string[]) {
    this.rawPatterns.push(...patterns);
    this.compile();
  }
}
