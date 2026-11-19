import sys, time, subprocess
from playwright.sync_api import sync_playwright
srv = subprocess.Popen([sys.executable,'-m','http.server','8765','--directory','test'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = b.new_page(viewport={'width':1280,'height':720})
        logs=[]
        pg.on('console', lambda m: logs.append(m.type+': '+m.text[:400]))
        pg.on('pageerror', lambda e: logs.append('PAGEERROR: '+str(e)[:600]))
        t=time.time(); pg.goto('http://localhost:8765/index.html'+(__import__('os').environ.get('HASH','')))
        try:
            pg.wait_for_function('window.__ready===true', timeout=60000)
        except Exception as e:
            logs.append('timeout '+str(e)[:100])
        print('ready in', round(time.time()-t,1),'s')
        pg.wait_for_timeout(2500)
        pg.screenshot(path='shots/globe.png')
        steps = sys.argv[1:] 
        for i,js in enumerate(steps):
            pg.evaluate(js); pg.wait_for_timeout(3500); pg.screenshot(path=f'shots/s{i}.png')
        print('\n'.join(logs[:30]))
        print(pg.evaluate("document.getElementById('stat-fps').textContent + ' | ' + document.getElementById('stat-cells').textContent"))
        b.close()
finally:
    srv.kill()
