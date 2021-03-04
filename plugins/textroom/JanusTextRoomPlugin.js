import JanusPlugin from "./../../utils/JanusPlugin";
import Janus from "./../../Janus";
import TextRoomParticipant from "./TextRoomParticipant";
import JanusUtils from "../../utils/JanusUtils";

export default class JanusTextRoomPlugin extends JanusPlugin {

  /**
   * @type {Janus.RTCDataChannel}
   */
  dataChannel = null;

  /**
   *
   * @type {onDataChannelMessageListener}
   */
  onDataChannelMessageListener = null;

  /**
   *
   * @type {onDataChannelStateChangeListener}
   */
  onDataChannelStateChangeListener = null;

  /**
   * Array of Text Room participants
   * @type {TextRoomParticipant[]}
   */
  participants = null;

  /**
   *
   * @callback onParticipantsListener
   * @param {TextRoomParticipant[]} participants
   */
  onParticipantsListener = null;

  /**
   *
   * @type {onParticipantLeftListener}
   */
  onParticipantLeftListener = null;
  /**
   *
   * @callback onParticipantJoinedListener
   * @param {onParticipantJoinedListener} participant
   */
  /**
   *
   * @type {onParticipantJoinedListener}
   */
  onParticipantJoinedListener = null;

  constructor(janus) {
    super("janus.plugin.textroom", janus);

    this.userName = null;
    this.roomID = null;
    this.displayName = null;
    this.isRemoteDescriptionSet = false;
    this.onDataChannelMessage = this.onDataChannelMessage.bind(this);
    this.onDataChannelStateChange = this.onDataChannelStateChange.bind(this);
  }

  getUserName = () => this.userName;

  getDataChannel = () => this.dataChannel;

  /**
   *
   * @param {Number} roomID
   */
  setRoomID = (roomID) => {
    this.roomID = roomID;
  };

  /**
   *
   * @param {String} userName
   */
  setUserName = (userName) => {
    this.userName = userName;
  };

  /**
   *
   * @param {String} displayName
   */
  setDisplayName = (displayName) => {
    this.displayName = displayName;
  };

  /**
   *
   * @param listener {onParticipantsListener}
   */
  setOnParticipantsListener = (listener) => {
    this.onParticipantsListener = listener;
  };

  /**
   *
   * @param listener {onDataChannelMessageListener}
   */
  setOnDataChannelMessageListener = (listener) => {
    this.onDataChannelMessageListener = listener;
  };

  /**
   *
   * @param listener {onDataChannelStateChangeListener}
   */
  setOnDataChannelStateChangeListener = (listener) => {
    this.onDataChannelStateChangeListener = listener;
  };

  setup = async () => {
    var self = this;
    self.send({ request: 'setup'}, function(resp) {
      if(resp.janus == 'event' && resp.jsep && resp.plugindata) {
        var jsep = resp.jsep,
          pluginData = resp.plugindata.data;

        if(pluginData.textroom && pluginData.textroom == 'event' && pluginData.result == 'ok') {
          if(jsep.type == 'offer') {
            self.createAnswer(jsep)
          }
        }
      }
    })
  };

  async createAnswer(jsep) {
    let self = this;
    this.initDataChannel();
    this.pc.setRemoteDescription(jsep)
      .then(function() {
        console.log("Remote description accepted!");
        self.remoteSdp = jsep.sdp;
        // Any trickle candidate we cached?
        if(self.cachedCandidates && self.cachedCandidates.length > 0) {
          for(var i = 0; i< self.cachedCandidates.length; i++) {
            var candidate = self.cachedCandidates[i];
            Janus.debug("Adding remote candidate:", candidate);
            if(!candidate || candidate.completed === true) {
              // end-of-candidates
              self.pc.addIceCandidate(Janus.endOfCandidates);
            } else {
              // New candidate
              self.pc.addIceCandidate(candidate);
            }
          }
          self.cachedCandidates = [];
        }
        // Create the answer now
        self.pc.createAnswer({
          offerToReceiveAudio: false,
          offerToReceiveVideo: false,
          mandatory: {
            OfferToReceiveAudio: false,
            OfferToReceiveVideo: false
          }
        }).then(function(answer) {
          console.log(answer);
          // JSON.stringify doesn't work on some WebRTC objects anymore
          // See https://code.google.com/p/chromium/issues/detail?id=467366
          var jsep = {
            "type": answer.type,
            "sdp": answer.sdp
          };
          answer.sdp = jsep.sdp;
          console.log("Setting local description");
          self.pc.setLocalDescription(answer)
            .catch(function(error) {console.log('set local description error:', error)});
          console.log("Got SDP!", jsep);
          var body = { request: "ack" };
          self.sendAsyncWithJsep(body, jsep);
        }, function(error) {
          console.log('Create answer error:', error);
        });
      }, function(error){
        console.log('set remote description error:', error);
      });
  }

  initDataChannel() {
    this.dataChannel = this.pc.createDataChannel("JanusDataChannel", {ordered: true});
    this.dataChannel.onmessage = this.onDataChannelMessage;
    this.dataChannel.onopen = this.onDataChannelStateChange;
    this.dataChannel.onclose = this.onDataChannelStateChange;
    this.dataChannel.onerror = this.onDataChannelError;
    this.dataChannel.pending = [];
  }

  onDataChannelMessage(event) {
    console.log('Received message on data channel:', event);
    let data = (event.data && typeof event.data === 'string') ? JSON.parse(event.data) : event.data;
    if (data) {
      if(data.textroom === "success") {
        if(data.participants) {
          this.participants = data.participants.map(
            (participantsrData) =>
              new TextRoomParticipant(participantsrData)
          );
          if (
            this.onParticipantsListener != null &&
            typeof this.onParticipantsListener === "function"
          ) {
            this.onParticipantsListener(this.participants);
          }
        }
      } else if(data.textroom == 'join' && data.username !== this.getUserName()) {
        let participant = new TextRoomParticipant({'username': data.username, 'display': data.display});
        this.participants.push(participant);

        if (
          participant &&
          this.onParticipantJoinedListener != null &&
          typeof this.onParticipantJoinedListener === "function"
        ) {
          this.onParticipantJoinedListener(participant);
        }
      } else if(data.textroom == 'leave' && data.username !== this.getUserName()) {
        let participant = null;
        for(let i = 0; i < this.participants.length; i++) {
          if(this.participants[i].username === data.username){
            participant = this.participants.splice(i, 1);
            break;
          }
        }

        if (
          participant &&
          this.onParticipantLeftListener != null &&
          typeof this.onParticipantLeftListener === "function"
        ) {
          this.onParticipantLeftListener(participant);
        }
      }
    }


    if(typeof this.onDataChannelMessageListener == 'function') {
      this.onDataChannelMessageListener(event);
    }
  }

  onDataChannelStateChange(event) {
    var label = event.target.label;
    var protocol = event.target.protocol;
    var dcState = event.target.readyState || event.currentTarget || this.dataChannel.readyState;
    if(dcState === 'open') {
      this.onDataOpen(label, protocol);
    }
    if(dcState === 'close') {
      this.onDataClose(label, protocol);
    }

    if(typeof this.onDataChannelStateChangeListener == 'function') {
      this.onDataChannelStateChangeListener(event);
    }
  }

  onDataChannelError(event) {
    console.log('Data channel error:', event);
  };

  onDataOpen(label, protocol) {
    console.log('onDataOpen');
  };

  onDataClose(label, protocol) {
    console.log('onDataClose');
  };

  onMessage = async (message) => {
    switch (message.janus) {
      case "webrtcup": {
        this.isWebRtcUp = true;
        if (
          this.onWebRTCUpListener &&
          typeof this.onWebRTCUpListener === "function"
        ) {
          this.onWebRTCUpListener();
        }
        return;
      }

      case "trickle": {
        console.log("got trickle");
        if (this.isRemoteDescriptionSet) {
          console.log("adding ice to pc");
          await this.pc.addIceCandidate(
            new Janus.RTCIceCandidate({
              candidate: message.candidate.candidate,
              sdpMid: message.candidate.sdpMid,
              sdpMLineIndex: message.candidate.sdpMLineIndex,
            })
          );
        }

        this.cachedCandidates.push(
          new Janus.RTCIceCandidate({
            candidate: message.candidate.candidate,
            sdpMid: message.candidate.sdpMid,
            sdpMLineIndex: message.candidate.sdpMLineIndex,
          })
        );

        return;
      }

      case "detached": {
        console.log("plugin", "detached");
        return;
      }

      case "event": {
        const data = message.plugindata.data;
        console.log("plugin", "event", data);
        return;
      }
    }
  };

  sendDataChannel = (request) => {
    if(!request['transaction']) {
      request['transaction'] = JanusUtils.randomString(12);
    }
    if(this.dataChannel) {
      this.dataChannel.send(JSON.stringify(request))
    }
  };
  /**
   *
   * @returns {Promise<void>}
   */
  join = async () => {
    let userName = this.getUserName() ?? 'username-' + (Math.floor(Math.random() * Math.floor(999999)));
    this.setUserName(userName);
    try {
      let joinResponse = await this.sendDataChannel({
        textroom: "join",
        room: this.roomID,
        pin: "",
        display: this.displayName,
        username: userName
      });
    } catch (e) {
      console.error("join", e);
    }
  };

}
