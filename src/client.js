const request = require('request');
const socketClient = require('socket.io-client');

module.exports = class Client {
    options = {
        connect: () => {},
        hold: () => {},
        back: () => {},
        error: () => {},
        disconnect: () => {},
    };
    constructor(localUrl, remoteUrl, options) {
        this.localUrl = localUrl;
        this.remoteUrl = remoteUrl;
        Object.assign(this.options, options); 
    }
    connect(socketOptions = {}) {
        let u = new URL(this.remoteUrl);
        let url = ['ws', u.protocol === 'https' ? 's' :'', '://', u.host ].join('');

        let socket = socketClient(url, socketOptions);

        socket.on('connect', () => {
            this.options.connect();
            socket.emit('client', { 
                meta: this.options.meta
             });
        });
        socket.on('hold', () => {
            this.options.hold();
            // console.log('[NLT] New client online, Sorry I have to put you on hold...')
        })
        socket.on('back', () => {
            this.options.back();
            //console.log('[NLT] You are back online, ready to handle remote requests')
        })
        socket.on('req', (data) => {
            // don't follow redirect and ignore https cert error
            var reqOpt = {
                followRedirect : false,
                checkServerIdentity : function(){
                    return undefined;
                }
            }
            Object.assign(reqOpt,data);
            reqOpt.url = this.localUrl + data.url;
            reqOpt.encoding = null;
            // fix error [socket hang up], no need to set content-length in request headers
            delete reqOpt.headers['Content-Length'];
            // then construct a request to local server

            request(reqOpt, (err, response, body) => {
                if(err) {
                    this.options.error(err);
                     //console.log('[NLT] relay error', err);
                    return;  
                } 
                   
                for(let i in response.rawHeaders){
                    var header = response.rawHeaders[i].toLowerCase();
                    if( response.headers[header] ){
                        response.headers[response.rawHeaders[i]] = response.headers[header];
                        delete response.headers[header];
                    }
                }

                // then send response back to main server
                socket.emit('resHead', {
                    _clientId: data._clientId, 
                    _reqId: data._reqId, 
                    statusCode: response ? response.statusCode : 500, 
                    headers: response ? response.headers : {}
                });
                socket.emit('resWrite', { 
                    _clientId: data._clientId, 
                    _reqId: data._reqId, 
                    res: err ? err.toString() : body, 
                });
                socket.emit('resEnd', {
                    _clientId: data._clientId, 
                    _reqId: data._reqId, 
                });
            })
        });
        socket.on('disconnect', (reason) => {
            this.options.disconnect(reason);
        });
        socket.on('error', (reason) => {
            this.options.error(reason);
        });
    }
}