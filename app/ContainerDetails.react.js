var _ = require('underscore');
var $ = require('jquery');
var React = require('react/addons');
var Router = require('react-router');
var exec = require('exec');
var path =  require('path');
var remote = require('remote');
var dialog = remote.require('dialog');
var ContainerStore = require('./ContainerStore');
var ContainerUtil = require('./ContainerUtil');
var docker = require('./docker');
var boot2docker = require('./boot2docker');
var ProgressBar = require('react-bootstrap/ProgressBar');
var Popover = require('react-bootstrap/Popover');
var OverlayTrigger = require('react-bootstrap/OverlayTrigger');

var ContainerDetails = React.createClass({
  mixins: [Router.State],
  _oldHeight: 0,
  PAGE_LOGS: 'logs',
  PAGE_SETTINGS: 'settings',
  getInitialState: function () {
    return {
      logs: [],
      page: this.PAGE_LOGS,
      env: {},
      pendingEnv: {},
      ports: {},
      volumes: {},
      popoverVolumeOpen: false,
      popoverPortsOpen: false,
    };
  },
  componentWillReceiveProps: function () {
    this.init();
  },
  componentWillMount: function () {
  },
  componentDidMount: function () {
    this.init();
    ContainerStore.on(ContainerStore.SERVER_PROGRESS_EVENT, this.updateProgress);
    ContainerStore.on(ContainerStore.SERVER_LOGS_EVENT, this.updateLogs);

    // Make clicking anywhere close popovers
    $('body').on('click', function (e) {
      console.log(e.target);
      console.log($('.popover-volume'));
      var volumeOpen = $('.popover-volume').is(e.target);
      var viewOpen = $('.popover-view').is(e.target);
      this.setState({
        popoverViewOpen: viewOpen,
        popoverVolumeOpen: volumeOpen
      });
    }.bind(this));
  },
  componentWillUnmount: function () {
    ContainerStore.removeListener(ContainerStore.SERVER_PROGRESS_EVENT, this.updateProgress);
    ContainerStore.removeListener(ContainerStore.SERVER_LOGS_EVENT, this.updateLogs);
  },
  componentDidUpdate: function () {
    var parent = $('.details-logs');
    if (!parent.length) {
      return;
    }
    if (parent.scrollTop() >= this._oldHeight) {
      parent.stop();
      parent.scrollTop(parent[0].scrollHeight - parent.height());
    }
    this._oldHeight = parent[0].scrollHeight - parent.height();
  },
  init: function () {
    this.setState({
      env: ContainerUtil.env(ContainerStore.container(this.getParams().name)),
      volumes: ContainerUtil.volumes(ContainerStore.container(this.getParams().name))
    });
    ContainerUtil.ports(ContainerStore.container(this.getParams().name), function (err, ports) {
      this.setState({
        ports: ports
      });
    }.bind(this));
    ContainerStore.fetchLogs(this.getParams().name, function () {
      this.updateLogs();
    }.bind(this));
  },
  updateLogs: function (name) {
    if (name && name !== this.getParams().name) {
      return;
    }
    this.setState({
      logs: ContainerStore.logs(this.getParams().name)
    });
  },
  updateProgress: function (name) {
    if (name === this.getParams().name) {
      this.setState({
        progress: ContainerStore.progress(name)
      });
    }
  },
  showLogs: function () {
    this.setState({
      page: this.PAGE_LOGS
    });
  },
  showSettings: function () {
    this.setState({
      page: this.PAGE_SETTINGS
    });
  },
  handleViewLink: function (url) {
    exec(['open', url], function (err) {
      if (err) { throw err; }
    });
  },
  handleRestart: function () {
    ContainerStore.restart(this.props.container.Name, function (err) {
      console.log(err);
    });
  },
  handleTerminal: function () {
    var container = this.props.container;
    var terminal = path.join(process.cwd(), 'resources', 'terminal').replace(/ /g, '\\\\ ');
    var cmd = [terminal, boot2docker.command().replace(/ /g, '\\\\ '), 'ssh', '-t', 'sudo', 'docker', 'exec', '-i', '-t', container.Name, 'bash'];
    exec(cmd, function (stderr, stdout, code) {
      if (code) {
        console.log(stderr);
      }
    });
  },
  handleSaveContainerName: function () {
    var newName = $('#input-container-name').val();
    var self = this;
    console.log(newName);
    ContainerStore.updateContainer(self.props.container.Name, {
      name: newName
    }, function (err) {
      if (err) {
        console.error(err);
      }
    });
  },
  handleSaveEnvVar: function () {
    var $rows = $('.env-vars .keyval-row');
    var envVarList = [];
    $rows.each(function () {
      var key = $(this).find('.key').val();
      var val = $(this).find('.val').val();
      if (!key.length || !val.length) {
        return;
      }
      envVarList.push(key + '=' + val);
    });
    var self = this;
    ContainerStore.updateContainer(self.props.container.Name, {
      Env: envVarList
    }, function (err) {
      if (err) {
        console.error(err);
      } else {
        self.setState({
          pendingEnv: {}
        });
        $('#new-env-key').val('');
        $('#new-env-val').val('');
      }
    });
  },
  handleAddPendingEnvVar: function () {
    var newKey = $('#new-env-key').val();
    var newVal = $('#new-env-val').val();
    var newEnv = {};
    newEnv[newKey] = newVal;
    this.setState({
      pendingEnv: _.extend(this.state.pendingEnv, newEnv)
    });
    $('#new-env-key').val('');
    $('#new-env-val').val('');
  },
  handleRemoveEnvVar: function (key) {
    var newEnv = _.omit(this.state.env, key);
    this.setState({
      env: newEnv
    });
  },
  handleRemovePendingEnvVar: function (key) {
    var newEnv = _.omit(this.state.pendingEnv, key);
    this.setState({
      pendingEnv: newEnv
    });
  },
  handleDeleteContainer: function () {
    dialog.showMessageBox({
      message: 'Are you sure you want to delete this container?',
      buttons: ['Delete', 'Cancel']
    }, function (index) {
      if (index === 0) {
        ContainerStore.remove(this.props.container.Name, function (err) {
          console.error(err);
        });
      }
    }.bind(this));
  },
  render: function () {
    var self = this;

    if (!this.state) {
      return <div></div>;
    }

    var logs = this.state.logs.map(function (l, i) {
      return <p key={i} dangerouslySetInnerHTML={{__html: l}}></p>;
    });

    if (!this.props.container) {
      return false;
    }

    var state;
    if (this.props.container.State.Running) {
      state = <h2 className="status running">running</h2>;
    } else if (this.props.container.State.Restarting) {
      state = <h2 className="status restarting">restarting</h2>;
    } else if (this.props.container.State.Paused) {
      state = <h2 className="status paused">paused</h2>;
    } else if (this.props.container.State.Downloading) {
      state = <h2 className="status">downloading</h2>;
    }

    var button;
    if (this.state.progress === 1) {
      button = <a className="btn btn-primary" onClick={this.handleClick}>View</a>;
    } else {
      button = <a className="btn btn-primary disabled" onClick={this.handleClick}>View</a>;
    }

    var envVars = _.map(this.state.env, function (val, key) {
      return (
        <div key={key} className="keyval-row">
          <input type="text" className="key line" defaultValue={key}></input>
          <input type="text" className="val line" defaultValue={val}></input>
          <a onClick={self.handleRemoveEnvVar.bind(self, key)} className="only-icon btn btn-action small"><span className="icon icon-cross"></span></a>
        </div>
      );
    });
    var pendingEnvVars = _.map(this.state.pendingEnv, function (val, key) {
      return (
        <div key={key} className="keyval-row">
          <input type="text" className="key line" defaultValue={key}></input>
          <input type="text" className="val line" defaultValue={val}></input>
          <a onClick={self.handleRemovePendingEnvVar.bind(self, key)} className="only-icon btn btn-action small"><span className="icon icon-arrow-undo"></span></a>
        </div>
      );
    });

    var body;
    if (this.props.container.State.Downloading) {
      body = (
        <div className="details-progress">
          <ProgressBar now={this.state.progress * 100} label="%(percent)s%" />
        </div>
      );
    } else {
      if (this.state.page === this.PAGE_LOGS) {
        body = (
          <div className="details-panel details-logs">
            <div className="logs">
              {logs}
            </div>
          </div>
        );
      } else {
        body = (
          <div className="details-panel">
            <div className="settings">
              <h3>Container Name</h3>
              <div className="container-name">
                <input id="input-container-name" type="text" className="line" placeholder="Container Name" defaultValue={this.props.container.Name}></input>
              </div>
              <a className="btn btn-action" onClick={this.handleSaveContainerName}>Save</a>
              <h3>Environment Variables</h3>
              <div className="env-vars-labels">
                <div className="label-key">KEY</div>
                <div className="label-val">VALUE</div>
              </div>
              <div className="env-vars">
                {envVars}
                {pendingEnvVars}
                <div className="keyval-row">
                  <input id="new-env-key" type="text" className="key line"></input>
                  <input id="new-env-val" type="text" className="val line"></input>
                  <a onClick={this.handleAddPendingEnvVar} className="only-icon btn btn-positive small"><span className="icon icon-add-1"></span></a>
                </div>
              </div>
              <a className="btn btn-action" onClick={this.handleSaveEnvVar}>Save</a>
              <h3>Delete Container</h3>
              <a className="btn btn-action" onClick={this.handleDeleteContainer}>Delete Container</a>
            </div>
          </div>
        );
      }
    }

    var disabledClass = '';
    if (!this.props.container.State.Running) {
      disabledClass = 'disabled';
    }

    var buttonClass = React.addons.classSet({
      btn: true, 'btn-action': true,
      'with-icon': true,
      disabled: !this.props.container.State.Running
    });
    var dropdownButtonClass = React.addons.classSet({
      btn: true,
      'btn-action': true,
      'with-icon': true,
      'dropdown-toggle': true,
      disabled: !this.props.container.State.Running
    });

    var textButtonClasses = React.addons.classSet({
      'btn': true,
      'btn-action': true,
      'only-icon': true,
      'active': this.state.page === this.PAGE_LOGS,
      disabled: this.props.container.State.Downloading
    });

    var gearButtonClass = React.addons.classSet({
      'btn': true,
      'btn-action': true,
      'only-icon': true,
      'active': this.state.page === this.PAGE_SETTINGS,
      disabled: this.props.container.State.Downloading
    });

    var viewPopoverClasses = React.addons.classSet({
      popover: true,
      hidden: false
    });

    var ports = _.map(self.state.ports, function (val, key) {
      return (
        <div port={key} className="port-row">
          <span>{key}</span>
          <a onClick={self.handleViewLink.bind(self, val.url)}>{val.display}</a>
        </div>
      );
    });

    var volumes = _.map(self.state.volumes, function (val, key) {
      return (
        <div port={key} className="port-row">
        <span>{key}</span>
        <a>{val}</a>
        </div>
      );
    });

    var popoverVolumeClasses = React.addons.classSet({
      'popover-volume': true,
      hidden: !this.state.popoverVolumeOpen
    });

    var popoverViewClasses = React.addons.classSet({
      'popover-volume': true,
      hidden: !this.state.popoverViewOpen
    });

    return (
      <div className="details">
        <div className="details-header">
          <div className="details-header-info">
            <h1>{this.props.container.Name}</h1>{state}<h2 className="image-label">Image</h2><h2 className="image">{this.props.container.Config.Image}</h2>
          </div>
          <div className="details-header-actions">
            <div className="action btn-group">
              <a className={buttonClass} onClick={this.handleView}><span className="icon icon-preview-2"></span><span className="content">View</span></a>
              <Popover className={popoverViewClasses}>
                <div className="port-labels">
                  <div className="label-docker">DOCKER PORT</div>
                  <div className="label-local">LOCAL PORT</div>
                </div>
                <div className="ports">
                  {ports}
                </div>
              </Popover>
              <a className={dropdownButtonClass}><span className="icon-dropdown icon icon-arrow-37"></span></a>
            </div>
            <div className="action">
              <Popover className={popoverVolumeClasses}>
                <div className="port-labels">
                <div className="label-docker">DOCKER FOLDER</div>
                <div className="label-local">LOCAL FOLDER</div>
                </div>
                <div className="ports">
                  {volumes}
                </div>
              </Popover>
              <a className={dropdownButtonClass}><span className="icon icon-folder-1"></span> <span className="content">Volumes</span> <span className="icon-dropdown icon icon-arrow-37"></span></a>
            </div>
            <div className="action">
              <a className={buttonClass} onClick={this.handleRestart}><span className="icon icon-refresh"></span> <span className="content">Restart</span></a>
            </div>
            <div className="action">
              <a className={buttonClass} onClick={this.handleTerminal}><span className="icon icon-window-code-3"></span> <span className="content">Terminal</span></a>
            </div>
            <div className="details-header-actions-rhs tabs btn-group">
              <a className={textButtonClasses} onClick={this.showLogs}><span className="icon icon-text-wrapping-2"></span></a>
              <a className={gearButtonClass} onClick={this.showSettings}><span className="icon icon-setting-gear"></span></a>
            </div>
          </div>
        </div>
        {body}
      </div>
    );
  }
});

module.exports = ContainerDetails;
