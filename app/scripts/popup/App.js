// @flow

import log from 'loglevel';
import React, {Component} from 'react';

import {Main} from './Main';
import {Login} from './Login';
import {sendMessageToBackground} from './communication';
import {setupLogging} from '../core/util';

type State = {
  username: ?string;
  closeOnLogin: boolean;
}

export class App extends Component {
  state: State;

  constructor() {
    super();
    setupLogging();

    const closeOnLogin = /closeOnLogin=true/.test(window.location.search);

    this.state = {
      username: null,
      closeOnLogin
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

    if (this.state.closeOnLogin) {
      chrome.tabs.getCurrent(function(tab: ?chrome$Tab) {
        if (tab && tab.id) {
          chrome.tabs.remove(tab.id, function() {});
        }
      });
    }
  }

  render() {
    if (this.state.username) {
      return (
        <Main
          username={this.state.username}
          handleLogout={this.handleLogout.bind(this)} />
      );
    } else {
      return (
        <Login
          handleLogin={this.handleLogin.bind(this)} />
      );
    }
  }
}
