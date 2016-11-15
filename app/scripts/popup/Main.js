// @flow

import React, {Component} from 'react';

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
      <div>
        <h2>Logged in!</h2>
        { this.state.err ? <h3 className="err">{this.state.err}</h3> : '' }
        <form onSubmit={this.handleLogout.bind(this)}>
          <input type="submit" value="Logout" />
        </form>
      </div>
    );
  }
}
