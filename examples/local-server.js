var express = require('express'),
	app = express();

var	bodyParser = require('body-parser'),
	compression = require('compression');

	app.use((req, res,next) => {
		next();
	});
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended:true}));
app.use(compression());
app.use(express.static('assets/'));

app.use('/foo',function(req, res, next){
	console.log('querys:', req.query, 'body:', req.body);
	res.send('ok from 3001')
})
app.use('/foo/:id',function(req, res, next){
	console.log('querys:', req.query, 'body:', req.body, 'params:', req.params.id);
	res.send('ok from 3001')
})
app.listen(3001);

