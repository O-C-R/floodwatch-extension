// @flow

import React, {Component} from 'react';
import log from 'loglevel';

type State = {
  logLevel: number;
}

export class App extends Component {
  state: State;

  constructor() {
    super();

    this.state = {
      logLevel: log.getLevel()
    }

    chrome.storage.onChanged.addListener((changes: Object) => {
      if (changes.logLevel !== undefined && changes.logLevel.newValue !== undefined) {
        log.setLevel(changes.logLevel.newValue);
        this.setState({ logLevel: changes.logLevel.newValue });
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

  render() {
    return (
      <div>
        <span>Log level: </span>
        <select value={this.state.logLevel} onChange={this.handleLogLevelChange.bind(this)}>
          <option value={log.levels.TRACE}>Trace</option>
          <option value={log.levels.DEBUG}>Debug</option>
          <option value={log.levels.INFO}>Info</option>
          <option value={log.levels.WARN}>Warn</option>
          <option value={log.levels.ERROR}>Error</option>
          <option value={log.levels.SILENT}>Silent</option>
        </select>
      </div>
    )
  }
}
