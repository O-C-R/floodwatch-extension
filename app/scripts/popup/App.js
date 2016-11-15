// @flow

import React, {Component} from 'react';

import {Main} from './Main';
import {Login} from './Login';
import {sendMessageToBackground} from './communication';

type State = {
  isSubmitting: boolean;
  username: ?string;
  err: ?string;

  usernameField: string;
  passwordField: string;
}

export class App extends Component {
  state: State;

  constructor() {
    super();

    this.state = {
      isSubmitting: false,
      username: null,
      err: null,

      usernameField: '',
      passwordField: ''
    };

    sendMessageToBackground('getLoginStatus', null)
      .then((res: { username: string }) => {
        this.setState({ username: res.username });
      });
  }

  handleLogout(event: Event) {
    this.setState({
      isSubmitting: true,
      usernameField: '',
      passwordField: ''
    });
    event.preventDefault();

    sendMessageToBackground('logout', null)
    .then((res: { err?: string }) => {
      this.setState({ isSubmitting: false });
      if (!res.err) {
        this.setState({ username: null });
      } else {
        this.setState({ err: res.err });
      }
    });
  }

  render() {
    if (this.state.username) {
      return (
        <Main
          username={this.state.username}
          handleLogout={this.handleLogout.bind(this)}/>
      );
    } else {
      return (<Login />);
    }
  }
}
