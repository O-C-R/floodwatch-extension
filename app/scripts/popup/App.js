// @flow

import log from 'loglevel';
import React, {Component} from 'react';

import {Main} from './Main';
import {Login} from './Login';
import {sendMessageToBackground} from './communication';
import {setupLogging} from '../core/util';
import {FW_WEB_HOST} from '../core/constants';

type State = {
  username: ?string;
  tab: boolean;
  version: string;
}

const TAB_STYLE = `
html, body {
    height: 100%;
    width: 100%;

    position: relative;
}

body {
    background-color: #000;
    background-image: url('images/back.jpg');
    background-size: cover;
    background-position: center;
}`;

export class App extends Component {
  state: State;

  constructor() {
    super();
    setupLogging();

    const tab = /tab=true/.test(window.location.search);

    this.state = {
      username: null,
      tab,
      version: chrome.runtime.getManifest().version || ''
    };

    sendMessageToBackground('getLoginStatus', null)
      .then((res: { username: string }) => {
        log.debug('Got loginStatus response', res);
        if (res.username) {
          this.setState({ username: res.username });
        }
      });
  }

  handleLogout() {
    log.trace('handleLogout called.');
    this.setState({ username: null });
  }

  handleLogin(username: string) {
    this.setState({ username });
  }

  render() {
    return (
      <div className={['extension', this.state.tab ? 'tab' : ''].join(' ')}>
        { this.state.tab && <style>{TAB_STYLE}</style> }

        <div className="extension_header">
          <h1 className="extension_header_logo">Floodwatch</h1>
        </div>

        { this.state.username ?
          <Main
            username={this.state.username}
            handleLogout={this.handleLogout.bind(this)} />
          :
          <Login
            handleLogin={this.handleLogin.bind(this)} />
        }

        <footer className="extension_footer">
          <a className="extension_footer_about" href={`${FW_WEB_HOST}/about`} target="blank">About Floodwatch</a>
          <p className="extension_footer_version">v{this.state.version}</p>
        </footer>
      </div>
    );
  }
}
