// @flow

import React, {Component} from 'react';
import {sendMessageToBackground} from './communication';

type State = {
  isSubmitting: boolean;
  username: ?string;
  err: ?string;

  usernameField: string;
  passwordField: string;
}

export class Login extends Component {
  state: State;

  constructor() {
    super();

    this.state = {
      isSubmitting: false,
      username: null,
      err: null,

      usernameField: '',
      passwordField: '',
    };

    sendMessageToBackground('getLoginStatus', null)
      .then((res: { username: string }) => {
        this.setState({ username: res.username });
      });
  }

  handleUsernameChange(event: Event) {
    if (event.target instanceof HTMLInputElement) {
      this.setState({ usernameField: event.target.value });
    }
  }

  handlePasswordChange(event: Event) {
    if (event.target instanceof HTMLInputElement) {
      this.setState({ passwordField: event.target.value });
    }
  }

  handleSubmit(event: Event) {
    this.setState({ isSubmitting: true });
    event.preventDefault();

    sendMessageToBackground('login', {
      username: this.state.usernameField,
      password: this.state.passwordField
    }).then((res: { username?: string, err?: string }) => {
      this.setState({
        isSubmitting: false,
        username: res.username || null,
        err: res.err || null
      });
    });
  }

  render() {
    return (
      <div>
        <h2>Please log in</h2>
        { this.state.err ? <h3 class="err">{this.state.err}</h3> : '' }
        <form onSubmit={this.handleSubmit.bind(this)}>
          Username:
          <input type="text" value={this.state.usernameField} onChange={this.handleUsernameChange.bind(this)} />
          <br />
          Password:
          <input type="password" value={this.state.passwordField} onChange={this.handlePasswordChange.bind(this)} />
          <br />

          <input type="submit" value="Submit" disabled={this.state.isSubmitting} />
        </form>
      </div>
    );
  }
}