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
        { this.state.err ? <h3 className="error">{this.state.err}</h3> : '' }

        <main className="extension_main">
          <form onSubmit={this.handleLogout.bind(this)}>
            <img className="extension_check" src="images/check.svg" alt=""/>
            <input
              className="extension_submit"
              disabled={this.state.isSubmitting}
              type="submit"
              value="Logout" />
          </form>
        </main>
      </div>
    );
  }
}
