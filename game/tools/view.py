import sys, time, subprocess, os
from playwright.sync_api import sync_playwright
srv = subprocess.Popen([sys.executable,'-m','http.server','8765','--directory','test'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        W,Hh = (int(os.environ.get('VW','1280')), int(os.environ.get('VH','720')))
        pg = b.new_page(viewport={'width':W,'height':Hh})
        logs=[]
        pg.on('console', lambda m: logs.append(m.type+': '+m.text[:400]) if m.type in ('error','log','warning') and 'ReadPixels' not in m.text else None)
        pg.on('pageerror', lambda e: logs.append('PAGEERROR: '+str(e)[:600]))
        pg.goto('http://localhost:8765/index.html'+os.environ.get('HASH',''))
        pg.wait_for_function('window.__ready===true', timeout=90000)
        pg.evaluate("document.getElementById('btn-join').click(); document.getElementById('btn-enter').click(); document.getElementById('help').hidden=true;")
        pg.wait_for_timeout(1500)
        pre = os.environ.get('PRE')
        if pre: print('pre:', pg.evaluate(pre))
        args = sys.argv[1:]
        for i in range(0,len(args),2):
            r = pg.evaluate(args[i]); 
            if r is not None: print('js:', r)
            pg.wait_for_timeout(int(os.environ.get('WAIT','4000'))); 
            try: pg.screenshot(path='shots/'+args[i+1]+'.png', timeout=90000)
            except Exception as e: print('shot fail', str(e)[:80])
        print('\n'.join(logs[:30]))
        b.close()
finally:
    srv.kill()
