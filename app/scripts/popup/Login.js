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
      <div className="extension">
        <div className="extension_header">
          <h1 className="extension_header_logo">Floodwatch</h1>
        </div>

        { this.state.err ? <h3 className="error">{this.state.err}</h3> : '' }

        <main className="extension_main">
          <form className="extension_form" onSubmit={this.handleSubmit.bind(this)}>
            <input className="extension_input" placeholder="username" type="text" value={this.state.usernameField} onChange={this.handleUsernameChange.bind(this)} />
            <input className="extension_input" placeholder="password" type="password" value={this.state.passwordField} onChange={this.handlePasswordChange.bind(this)} />
            <input className="extension_submit" type="submit" value="Login" disabled={this.state.isSubmitting} />
            <a className="extension_password-lost" href="https://floodwatch.me/lostpassword" target="blank">Password lost ?</a>
            <p className="extension_signup">Not a Floodwatch user? <a href="https://floodwatch.me/signup" target="blank">Sign up</a></p>
          </form>
        </main>

        <footer className="extension_footer">
          <a className="extension_footer_about" href="https://floodwatch.me/about" target="blank">About Floodwatch</a>
          <p className="extension_footer_version">V 0.1</p>
        </footer>
      </div>
    );
  }
}
