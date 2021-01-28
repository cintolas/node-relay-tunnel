const socketClient = require('socket.io-client');

module.exports = class Bridge {
    constructor(port, opts = {}) {
        let url  = ['ws://localhost:', port].join('');

        this.socket = socketClient(url, opts);
        this.socket.on('connect', () => {
            this.socket.emit('bridge', {});
        });
        this.socket.on('disconnect', (reason) => {
            console.log(reason)
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
            body : req.body, 
            query: req.query
        });
    }
    websocket(req) {
        this.socket.emit('websocket', {
            _reqId : req._reqId,
            _clientId: req._clientId,
            url : req.url,
            headers:req.headers,
            method : req.method,
            body : req.body,
            query: req.query
        });
    }
    eventStream(req) {

    }
}