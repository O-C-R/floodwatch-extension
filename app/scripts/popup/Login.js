// @flow

import React, {Component} from 'react';
import {sendMessageToBackground} from './communication';
import {FW_WEB_HOST} from '../core/constants';

type Props = {
  handleLogin: (username: string) => void;
}

type State = {
  isSubmitting: boolean;
  err: ?string;

  usernameField: string;
  passwordField: string;
}

export class Login extends Component {
  state: State;

  constructor(props: Props) {
    super(props);

    this.state = {
      isSubmitting: false,
      err: null,

      usernameField: '',
      passwordField: ''
    };
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
      this.setState({ isSubmitting: false, err: res.err || null });
      if (res.username) {
        this.props.handleLogin(res.username);
      }
    });
  }

  render() {
    return (
      <div>
        { this.state.err ? <h3 className="error">{this.state.err}</h3> : '' }

        <main className="extension_main">
          <form className="extension_form" onSubmit={this.handleSubmit.bind(this)}>
            <input className="extension_input" placeholder="username" type="text" value={this.state.usernameField} onChange={this.handleUsernameChange.bind(this)} />
            <input className="extension_input" placeholder="password" type="password" value={this.state.passwordField} onChange={this.handlePasswordChange.bind(this)} />
            <input className="extension_submit" type="submit" value="Login" disabled={this.state.isSubmitting} />
            <a className="extension_password-lost" href={`${FW_WEB_HOST}/lostpassword`} target="blank">Password lost?</a>
            <p className="extension_signup">Not a Floodwatch user? <a href={`${FW_WEB_HOST}/signup`} target="blank">Sign up!</a></p>
          </form>
        </main>
      </div>
    );
  }
}
