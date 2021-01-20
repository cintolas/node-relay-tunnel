const socketClient = require('socket.io-client');

module.exports = class Bridge {
    constructor(port) {
        let url  = ['ws://localhost:', port].join('');

        this.socket = socketClient(url);
        this.socket.on('connect', () => {
            this.socket.emit('bridge', {});
        });
        this.socket.on('disconnect', () => {
        });
        this.socket.on('error', console.log)
    }
    request(req) {
        this.socket.emit('req', {
            _reqId : req._reqId,
            _clientId: req._clientId,
            url : req.url,
            headers:req.headers,
            method : req.method,
            form : req.body
        });
    }
    onResHead(fn = () => {}) {
        this.socket.on('resHead', fn);
    }
    onResWrite(fn = () => {}) {
        this.socket.on('resWrite', fn);
    }
    onResEnd(fn = () => {}) {
        this.socket.on('resEnd', fn);
    }
}