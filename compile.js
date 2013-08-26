var mustache = require('mustache');
var fs = require('fs');

var css, js, template, compiled, FILES;

FILES = {
  css: './styles.css',
  js: './index.js',

  template: 'hangoutapp.xml.mustache',
  output: 'hangoutapp.xml'
};

// Read files
css = fs.readFileSync(FILES.css, {encoding: 'utf8'});
js = fs.readFileSync(FILES.js, {encoding: 'utf8'});
template = fs.readFileSync(FILES.template, {encoding: 'utf8'});

// Compile
compiled = mustache.render(template, {
  css: css,
  js: js
});

// Write compiled file
fs.writeFile(FILES.output, compiled, function(error) {
  if(error) {
    throw error;
  } else {
    console.log('Compiled and saved as '+FILES.output);
  }
});
