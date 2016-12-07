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
          <div className="extension_stats">
              <div className="extension_stats_item"><span className="extension_stats_label">Ads seen today</span><span className="extension_stats_value">42</span></div>
              <div className="extension_stats_item"><span className="extension_stats_label">Ads seen all time</span><span className="extension_stats_value">666</span></div>
          </div>

          <div className="extension_actions">        
            <a href="#" className="extension_dashboard">Dashboard</a>
            <form onSubmit={this.handleLogout.bind(this)}>
              <input
                className="extension_submit"
                disabled={this.state.isSubmitting}
                type="submit"
                value="Logout" />
            </form>
          </div>
        </main>
      </div>
    );
  }
}
