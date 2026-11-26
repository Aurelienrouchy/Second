"""refactor-mover — déplace des fichiers et réécrit les imports PAR RÉSOLUTION.

Écrit pendant le refacto feature-first (sept. 2026). Conservé parce que l'étage 3
(extraction de logique hors des 55 routes grasses de app/) en aura besoin.

Ce qu'il fait, et pourquoi pas un chercher-remplacer :
  - `git mv` chaque fichier (l'historique est préservé, git détecte le renommage) ;
  - pour CHAQUE import du dépôt, il résout le specifier vers son fichier cible dans
    l'ANCIENNE arborescence, puis ré-émet le specifier depuis la NOUVELLE ;
  - il ne réécrit QUE si la cible a réellement bougé — sinon le diff se remplit de
    conversions relatif -> @/ sans rapport avec le déplacement, et devient illisible.

Il scanne aussi tests/ : les chaînes de `jest.mock('@/…')` ne sont vues ni par tsc
ni par le typecheck, et cassent silencieusement au déplacement.

Usage :
    python3 scripts/refactor-mover.py "ancien/chemin.ts:nouveau/chemin.ts" ...
Un couple dossier:dossier déplace récursivement.

Après usage, TOUJOURS : npx tsc --noEmit (app + functions), les 3 suites de tests,
et npm run lint:boundaries.
"""

import re,os,sys,subprocess,collections

ROOT=os.getcwd()
SRC_DIRS="app components features hooks store services lib utils types constants config data tests".split()

def all_files():
    out=[]
    for d in SRC_DIRS:
        if os.path.isdir(d):
            out+=subprocess.run(['bash','-c',f"find {d} -type f \\( -name '*.ts' -o -name '*.tsx' \\)"],
                                capture_output=True,text=True).stdout.split()
    return [f for f in out if 'node_modules' not in f]

def norm(p): return re.sub(r'\.(tsx?)$','',p)

def build_alias(files):
    a={}
    for f in files:
        n=norm(f); a[n]=f
        n2=re.sub(r'\.(ios|android|native|web)$','',n)   # variantes plateforme
        a.setdefault(n2,f)
        if os.path.basename(n)=='index': a[os.path.dirname(n)]=f
    return a

def resolve(spec, from_file, alias):
    if spec.startswith('@/'): t=spec[2:]
    elif spec.startswith('.'): t=os.path.normpath(os.path.join(os.path.dirname(from_file),spec))
    else: return None
    t=re.sub(r'\.(tsx?)$','',t)
    for c in (t, t+'/index'):
        if c in alias: return alias[c]
    return None

def spec_for(target_new, from_new):
    n=norm(target_new)
    if os.path.basename(n)=='index': n=os.path.dirname(n)
    n=re.sub(r'\.(ios|android|native|web)$','',n)
    if os.path.dirname(target_new)==os.path.dirname(from_new):
        b=os.path.basename(n)
        return './'+b
    return '@/'+n

def main(pairs):
    files=all_files(); alias=build_alias(files)
    # --- construction de la table de déplacement fichier->fichier
    movemap={}
    for old,new in pairs:
        if os.path.isdir(old):
            for f in files:
                if f.startswith(old.rstrip('/')+'/'):
                    movemap[f]=new.rstrip('/')+f[len(old.rstrip('/')):]
        else:
            if old in files: movemap[old]=new
            else: print("  !! introuvable:",old)
    if not movemap: print("rien à déplacer"); return
    # --- git mv
    for old,new in movemap.items():
        os.makedirs(os.path.dirname(new),exist_ok=True)
        r=subprocess.run(['git','mv',old,new],capture_output=True,text=True)
        if r.returncode!=0:
            print("  git mv KO",old,r.stderr.strip()); return
    print("  %d fichier(s) déplacé(s)"%len(movemap))
    # --- réécriture des imports, par résolution
    newfiles=[movemap.get(f,f) for f in files]
    changed=0
    for oldf in files:
        nf=movemap.get(oldf,oldf)
        try: s=open(nf,encoding='utf8').read()
        except FileNotFoundError: continue
        orig=s
        def repl(m):
            q,spec=m.group(1),m.group(2)
            tgt=resolve(spec,oldf,alias)         # résolution dans l'ANCIENNE arbo
            if not tgt: return m.group(0)
            newtgt=movemap.get(tgt,tgt)
            # RÈGLE: ne réécrire QUE si la cible a bougé, ou si le fichier
            # courant a bougé et que son import relatif ne pointe plus juste.
            if newtgt==tgt and nf==oldf: return m.group(0)
            if newtgt==tgt and not spec.startswith('.'): return m.group(0)
            want=spec_for(newtgt,nf)
            if want==spec: return m.group(0)
            return m.group(0).replace(q+spec+q, q+want+q)
        s=re.sub(r"""(['"])(@/[^'"]+|\.{1,2}/[^'"]+)\1""", repl, s)
        if s!=orig:
            open(nf,'w').write(s); changed+=1
    print("  %d fichier(s) d'imports réécrits"%changed)

if __name__=='__main__':
    pairs=[tuple(a.split(':',1)) for a in sys.argv[1:]]
    main(pairs)
