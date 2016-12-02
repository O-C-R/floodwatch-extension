// @flow

import React, {Component} from 'react';
import log from 'loglevel';

type State = {
  logLevel: number;
  useDefaultIgnorePatterns: boolean;
  ignorePatterns: string;
}

const STORAGE_KEYS = ['logLevel', 'ignorePatterns', 'useDefaultIgnorePatterns'];

export class App extends Component {
  state: State;

  constructor() {
    super();

    this.state = {
      logLevel: log.getLevel(),
      useDefaultIgnorePatterns: true,
      ignorePatterns: ''
    }

    chrome.storage.sync.get(STORAGE_KEYS, (items: { [key: string]: any }) => {
      if (!chrome.runtime.lastError) {
        log.debug('Got items from storage', items);
        const newState = {};
        for (const key in items) {
          if (items[key] !== null && items[key] !== undefined) {
            newState[key] = items[key];
          }
        }
        log.debug('Setting state', newState);
        this.setState(newState);
      } else {
        log.error(chrome.runtime.lastError.message);
      }
    });

    chrome.storage.onChanged.addListener((changes: Object) => {
      if (changes.logLevel !== undefined && changes.logLevel.newValue !== undefined) {
        log.setLevel(changes.logLevel.newValue);
        this.setState({ logLevel: changes.logLevel.newValue });
      }

      if (changes.ignorePatterns !== undefined && changes.ignorePatterns.newValue !== undefined) {
        this.setState({ ignorePatterns: changes.ignorePatterns.newValue });
      }

      if (changes.useDefaultIgnorePatterns !== undefined && changes.useDefaultIgnorePatterns.newValue !== undefined) {
        this.setState({ useDefaultIgnorePatterns: changes.useDefaultIgnorePatterns.newValue });
      }
    });
  }

  handleLogLevelChange(event: Event) {
    if (event.target instanceof HTMLSelectElement) {
      const logLevel = parseInt(event.target.value);
      log.setLevel(logLevel, true);
      this.setState({ logLevel });
      chrome.storage.sync.set({ logLevel });
    }
  }

  handleIgnorePatterns(event: Event) {
    if (event.target instanceof HTMLTextAreaElement) {
      const ignorePatterns = event.target.value;

      this.setState({ ignorePatterns });
      chrome.storage.sync.set({ ignorePatterns });
    }
  }

  handleUseDefaultStoragePatternsChange(event: Event) {
    if (event.target instanceof HTMLInputElement && event.target.getAttribute('type') == 'checkbox') {
      const useDefaultIgnorePatterns = !this.state.useDefaultIgnorePatterns;
      this.setState({ useDefaultIgnorePatterns });
      chrome.storage.sync.set({ useDefaultIgnorePatterns });
    }
  }

  render() {
    return (
      <div>
        <div className="option-group">
          <span className="header">Logging</span>

          <div className="option">
            <span className="label">Log level: </span>
            <select value={this.state.logLevel} onChange={this.handleLogLevelChange.bind(this)}>
              <option value={log.levels.TRACE}>Trace</option>
              <option value={log.levels.DEBUG}>Debug</option>
              <option value={log.levels.INFO}>Info</option>
              <option value={log.levels.WARN}>Warn</option>
              <option value={log.levels.ERROR}>Error</option>
              <option value={log.levels.SILENT}>Silent</option>
            </select>
          </div>
        </div>

        <div className="option-group">
          <span className="header">Ignored websites</span>
          <div className="option">
            <span className="label">Use <a href="#">default ignore patterns</a>: </span>
            <input type="checkbox" onChange={this.handleUseDefaultStoragePatternsChange.bind(this)} checked={this.state.useDefaultIgnorePatterns}></input>
          </div>
          <br />
          <div className="option">
            <span className="label">Custom rules:</span>
            <textarea value={this.state.ignorePatterns} rows={10} cols={80} onChange={this.handleIgnorePatterns.bind(this)}>
            </textarea>
          </div>
        </div>
      </div>
    )
  }
}
