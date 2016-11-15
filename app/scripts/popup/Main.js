// @flow

import React, {Component} from 'react';

import log from 'loglevel';
import {sendMessageToBackground} from './communication';

type Props = {
  username: string;
  handleLogout: () => Promise<void>;
};

type State = {
  isSubmitting: boolean;
  err: ?string;
};

export class Main extends Component {
  state: State;

  constructor(props: Props) {
    super(props);

    this.state = {
      isSubmitting: false,
      err: null
    };
  }

  handleLogout(event: Event) {
    event.preventDefault();
    log.debug('Logging out...');

    this.setState({ isSubmitting: true });

    sendMessageToBackground('logout', null)
    .then((res: { err?: string }) => {
      log.debug('Logout response', res);
      this.setState({ isSubmitting: false });
      if (!res.err) {
        this.props.handleLogout();
      } else {
        this.setState({ err: res.err });
      }
    });
  }

  render() {
    return (
      <div>
        <h2>Logged in!</h2>
        { this.state.err ? <h3 className="err">{this.state.err}</h3> : '' }
        <form onSubmit={this.handleLogout.bind(this)}>
          <input type="submit" value="Logout" disabled={this.state.isSubmitting}/>
        </form>
      </div>
    );
  }
}
