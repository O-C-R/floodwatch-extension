// @flow

import React, {Component} from 'react';
import {sendMessageToBackground} from './communication';

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
      passwordField: '',
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
        <h2>Please log in</h2>
        { this.state.err ? <h3 className="err">{this.state.err}</h3> : '' }
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
