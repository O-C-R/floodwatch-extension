// @flow

import React, {Component} from 'react';

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
    this.props.handleLogout();
  }

  render() {
    return (
      <div className="extension">
        <div className="extension_header">
          <h1 className="extension_header_logo">Floodwatch</h1>
        </div>

        { this.state.err ? <h3 className="error">{this.state.err}</h3> : '' }

        <main className="extension_main">
          <form onSubmit={this.handleLogout.bind(this)}>
            <img className="extension_check" src="images/check.svg" alt=""/>
            <input className="extension_submit" type="submit" value="Logout" />
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
