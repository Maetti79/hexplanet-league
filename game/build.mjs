import fs from 'node:fs';
const tpl = fs.readFileSync('src/template.html','utf8'), main = fs.readFileSync('src/arena.js','utf8') + '\n' + fs.readFileSync('src/main.js','utf8') + '\n' + fs.readFileSync('src/league.js','utf8');
const b64 = f => fs.readFileSync('assets/' + f).toString('base64');
const mainA = main.replace('__AV_M__', () => b64('m.glb')).replace('__AV_F__', () => b64('f.glb'));
const mk = (url, add) => tpl.replace('__THREE_URL__', url).replace('__ADDONS_URL__', add).replace('__MAIN__', () => mainA);
fs.mkdirSync('dist',{recursive:true}); fs.mkdirSync('test',{recursive:true});
fs.writeFileSync('dist/index.html', mk('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js', 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/'));
fs.writeFileSync('test/index.html', mk('./three.module.min.js', './addons/'));
fs.copyFileSync('node_modules/three/build/three.module.min.js','test/three.module.min.js');
try { fs.symlinkSync(fs.realpathSync('node_modules/three/examples/jsm'), 'test/addons'); } catch (e) {}
console.log('ok', fs.statSync('dist/index.html').size);
