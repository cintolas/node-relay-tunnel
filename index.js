var util = require('util');
var qs = require('querystring');
const server = require('./src/server');
const client = require('./src/client');

var noop = function() {}


// a relay WS server(on the main server side), help communicate bettwen main server and local/debug serverf
function init(options){
	options = util._extend({ssl:null, port:12345}, options);
	var serverWorkers = {}; // save main server sockets
	var clientSocket = []; // save local server socket
	var clientOptions = []; // save optioin obj
	var wsServer;
	if(options.ssl)
		wsServer = require('https').createServer(options.ssl);
	else wsServer = require('http').createServer();
	var io = require('socket.io')(wsServer);
	
	if(options.auth)	
	io.set('authorization', function (handshakeData, callback) {
		if(handshakeData.url.match('username='+options.auth.username+'&password='+options.auth.password))
        	callback(null, true); // error first callback style 
        else callback('no auth', false);
    });

	io.on('connection', function(socket){
		// 0. save server sockets & local socket
		socket.on('init', function(data){
			if(data._type == 'localServer'){
				socket._type = 'localServer';
				if(clientSocket.length>0)
					clientSocket.slice(-1)[0].emit('hold');			
				// then handle new one
				clientSocket.push(socket);
				clientOptions.push(data);
				// inform server the new client
				for(i in serverWorkers)
					serverWorkers[i].emit('client', data);
			}else if(data._type == 'server'){
				socket._type = 'server';
				serverWorkers[socket.id] = socket;
			}else{
				// ignore this connection
			}
		})
		// handle req from server, relay data to client
		socket.on('req', function(data){
			if(clientSocket.length > 0){
				data._sid = socket.id;
				clientSocket.slice(-1)[0].emit('req', data)
			}
		})
		// handle res from client, relay the data to the server
		socket.on('res', function(data){
			if(serverWorkers[data._sid])
				serverWorkers[data._sid].emit('res', data);
		});
		socket.on('disconnect', function(reason){
			if(socket._type == 'localServer'){
				var last = false;
				for(i in clientSocket){
					if(socket.id == clientSocket[i].id){
						if(i == clientSocket.length-1)
							last = true;
						clientSocket.splice(i, 1);
						clientOptions.splice(i,1);
						break;
					}
				}
				if(clientSocket.length > 0 && clientOptions.length > 0){
					if(last)
						clientSocket.slice(-1)[0].emit('back');	
					for(i in serverWorkers)
						serverWorkers[i].emit('client', clientOptions.slice(-1)[0]);
				}
				else
					for(i in serverWorkers)
						serverWorkers[i].emit('client', false);
			}
			else if(socket._type == 'server')
				delete serverWorkers[socket.id];
		});
	});
	wsServer.listen(options.port).on('listening', function(){
		options.listening ? options.listening() : noop();
		//console.log('[NLT] Server is ready on port ' + options.port);
	}).on('error', function(e){
		options.error ? options.error(e) : noop();
		//console.log('[NLT] Setup error', e)
	});
}

module.exports = {
	Server : server,
	Client : client,
};
