"""
Sea Tycoon Defense - Python/Pygame prototype
Run:
  pip install pygame
  python sea_tycoon_defense.py

Controls:
  Menu: 1 Normal, 2 Blitz, 3 Endless
  Prep: Click ship rooms to upgrade, Enter to start
  Sea phase: Click lanes or press 1-5, Q/W/E/R for abilities
"""
import sys, time, random, pygame

W,H,FPS=1080,720,60
TOP,BOT,LANES=120,620,5
BG=(5,17,34); PANEL=(15,33,56); LINE=(52,89,116)
WHITE=(235,245,255); MUTED=(148,163,184); CYAN=(34,211,238); GOLD=(250,204,21)
GREEN=(34,197,94); RED=(239,68,68); BLUE=(59,130,246); ORANGE=(249,115,22); VIOLET=(139,92,246)
ROOMS=[('helm','Command','Ship body'),('cannons','Cannons','Impact power'),('engines','Engines','Action speed'),('arsenal','Arsenal','Reserve shots'),('shield','Shield','Protection'),('storage','Storage','Gold bonus'),('radar','Radar','Wave vision'),('crew','Crew','Ability cooldown')]
ENVS=['Clear','Fog','Storm','Night','Tide']

def lane_y(i): return int(TOP+(BOT-TOP)*((i+.5)/LANES))

class Game:
    def __init__(self):
        pygame.init(); self.s=pygame.display.set_mode((W,H)); pygame.display.set_caption('Sea Tycoon Defense')
        self.clock=pygame.time.Clock(); self.font=pygame.font.SysFont('Arial',22); self.small=pygame.font.SysFont('Arial',15); self.big=pygame.font.SysFont('Arial',50,True)
        self.mode='menu'; self.play_mode='normal'; self.gold=180; self.wave=0; self.levels={r[0]:0 for r in ROOMS}; self.reset_wave()
    def text(self,t,x,y,c=WHITE,f=None,center=False):
        im=(f or self.font).render(str(t),True,c); r=im.get_rect(); r.center=(x,y) if center else r.topleft; self.s.blit(im,r)
    def stats(self):
        L=self.levels
        return dict(hp=220+L['helm']*42, power=22+L['cannons']*7, delay=max(.16,.55-L['engines']*.07), shots=25+L['arsenal']*5, block=min(.45,L['shield']*.05), bonus=1+L['storage']*.13, time=45+L['radar']*4, cool=max(.45,1-L['crew']*.08))
    def reset_wave(self):
        st=self.stats(); self.hp=self.maxhp=st['hp']; self.shots=st['shots']; self.items=[]; self.marks=[]; self.kills=0; self.earned=0; self.last=0; self.spawn=0; self.left=0; self.env='Clear'; self.cd={'Q':0,'W':0,'E':0,'R':0}; self.freeze=0; self.fast=0
    def start(self,m):
        self.play_mode=m; self.gold=180; self.wave=0; self.levels={r[0]:0 for r in ROOMS}; self.reset_wave(); self.mode='prep'
    def cost(self,k): return int(80*(1.6**self.levels[k])+ROOMS.index(next(r for r in ROOMS if r[0]==k))*16)
    def start_wave(self):
        self.wave+=1; self.reset_wave(); self.mode='sea'; self.env=random.choice(ENVS); self.left=6+self.wave*2+(1 if self.wave%3==0 else 0)
    def make_boat(self):
        lane=random.randrange(LANES); boss=self.wave%3==0 and self.left==1
        if boss: hp,spd,coin,col=900+self.wave*25,28,140,ORANGE
        else:
            hp,spd,coin,col=random.choice([(65,80,12,GREEN),(150,55,24,GOLD),(320,35,44,RED)]); hp+=self.wave*8
        if self.play_mode=='blitz': spd*=1.5; coin*=2
        self.items.append({'x':W+40,'lane':lane,'hp':hp,'max':hp,'spd':spd,'coin':coin,'col':col,'boss':boss}); self.left-=1
    def shoot(self,l,free=False):
        now=time.time(); st=self.stats()
        if not free and now-self.last<st['delay']: return
        if not free and self.shots<=0: return
        if not free: self.shots-=1; self.last=now
        self.marks.append({'x':115,'lane':l,'p':st['power']*(1.25 if self.fast>0 else 1),'v':610*(1.8 if self.fast>0 else 1)})
    def ability(self,k):
        if self.mode!='sea' or self.cd[k]>0: return
        cool=self.stats()['cool']
        if k=='Q':
            for l in range(LANES): self.shoot(l,True)
            self.cd[k]=10*cool
        elif k=='W': self.hp=min(self.maxhp,self.hp+self.maxhp*.25); self.cd[k]=15*cool
        elif k=='E': self.fast=6; self.cd[k]=9*cool
        elif k=='R': self.freeze=3.5; self.cd[k]=13*cool
    def update_sea(self,dt):
        for k in self.cd: self.cd[k]=max(0,self.cd[k]-dt)
        self.freeze=max(0,self.freeze-dt); self.fast=max(0,self.fast-dt); self.spawn-=dt
        if self.left>0 and self.spawn<=0: self.make_boat(); self.spawn=max(.45,1.1-self.wave*.02)
        speed=0 if self.freeze>0 else 1.0
        if self.env=='Tide': speed*=1.3
        mark_speed=.75 if self.env=='Storm' else 1
        for b in list(self.items):
            b['x']-=b['spd']*speed*dt
            if b['x']<75: self.hp-=34*(1-self.stats()['block']); self.items.remove(b)
        for m in list(self.marks):
            m['x']+=m['v']*mark_speed*dt
            if m['x']>W+20: self.marks.remove(m); continue
            for b in list(self.items):
                if b['lane']==m['lane'] and abs(b['x']-m['x'])<34:
                    b['hp']-=m['p']
                    if m in self.marks: self.marks.remove(m)
                    if b['hp']<=0:
                        gain=int(b['coin']*self.stats()['bonus']); self.gold+=gain; self.earned+=gain; self.kills+=1; self.items.remove(b)
                    break
        if self.hp<=0: self.mode='result'
        if self.left<=0 and not self.items:
            bonus=int((40+self.wave*18)*self.stats()['bonus']*(2 if self.play_mode=='blitz' else 1)); self.gold+=bonus; self.earned+=bonus; self.mode='result'
    def draw_menu(self):
        self.s.fill(BG); self.text('SEA TYCOON DEFENSE',W//2,150,CYAN,self.big,True); self.text('Build your ship inside. Survive the sea outside.',W//2,215,MUTED,self.font,True)
        for i,(n,t,d) in enumerate([('1','Normal','Full loop'),('2','Blitz x2','Faster + more gold'),('3','Endless','Survival test')]):
            x=190+i*260; pygame.draw.rect(self.s,PANEL,(x,300,220,150),border_radius=22); pygame.draw.rect(self.s,CYAN,(x,300,220,150),2,border_radius=22); self.text(n,x+25,318,GOLD,self.big); self.text(t,x+75,325,WHITE); self.text(d,x+25,390,MUTED,self.small)
    def draw_prep(self):
        self.s.fill((6,28,49)); self.text(f'Prep Phase - Wave {self.wave+1}',60,44,CYAN,self.big); self.text(f'Gold: {self.gold}',60,108,GOLD); self.text('Click room to upgrade. Press Enter to start.',60,145,MUTED)
        for i,(k,n,d) in enumerate(ROOMS):
            x=60+(i%4)*245; y=220+(i//4)*150; pygame.draw.rect(self.s,PANEL,(x,y,220,115),border_radius=18); pygame.draw.rect(self.s,VIOLET if self.gold>=self.cost(k) else LINE,(x,y,220,115),2,border_radius=18)
            self.text(n,x+18,y+15); self.text(f'LV {self.levels[k]}/5',x+18,y+45,GREEN); self.text(d,x+18,y+72,MUTED,self.small); self.text(f'Cost {self.cost(k)}',x+120,y+45,GOLD,self.small)
    def draw_sea(self):
        self.s.fill((3,22,40))
        for i in range(LANES): pygame.draw.line(self.s,LINE,(0,lane_y(i)),(W,lane_y(i)),2); self.text(str(i+1),24,lane_y(i)-13,MUTED,self.small)
        pygame.draw.rect(self.s,BLUE,(35,TOP,58,BOT-TOP),border_radius=25); self.text('SHIP',43,H//2-8,WHITE,self.small)
        pygame.draw.rect(self.s,(90,35,35),(60,44,260,14),border_radius=8); pygame.draw.rect(self.s,GREEN,(60,44,int(260*max(0,self.hp/self.maxhp)),14),border_radius=8)
        self.text(f'HP {int(self.hp)}/{self.maxhp}',60,64,WHITE,self.small); self.text(f'Wave {self.wave} | Gold {self.gold} | Shots {self.shots} | Env {self.env}',360,42,GOLD); self.text('Q Wave | W Repair | E Speed | R Freeze',360,76,CYAN,self.small)
        for b in self.items:
            yy=lane_y(b['lane']); pygame.draw.rect(self.s,b['col'],(b['x']-35,yy-22,70,44),border_radius=18); pygame.draw.rect(self.s,RED,(b['x']-35,yy-31,70,5),border_radius=3); pygame.draw.rect(self.s,GREEN,(b['x']-35,yy-31,int(70*max(0,b['hp']/b['max'])),5),border_radius=3)
        for m in self.marks: pygame.draw.circle(self.s,GOLD,(int(m['x']),lane_y(m['lane'])),7)
    def draw_result(self):
        self.s.fill(BG); lost=self.hp<=0; self.text('SHIP DOWN' if lost else 'WAVE CLEARED',W//2,180,RED if lost else GREEN,self.big,True); self.text(f'Wave {self.wave}',W//2,260,WHITE,self.font,True); self.text(f'Cleared boats: {self.kills}',W//2,305,WHITE,self.font,True); self.text(f'Gold earned: {self.earned}',W//2,350,GOLD,self.font,True); self.text('Space: continue | Esc: menu',W//2,450,CYAN,self.font,True)
    def click_upgrade(self,pos):
        mx,my=pos
        for i,(k,_,_) in enumerate(ROOMS):
            x=60+(i%4)*245; y=220+(i//4)*150; r=pygame.Rect(x,y,220,115)
            if r.collidepoint(mx,my) and self.levels[k]<5 and self.gold>=self.cost(k): self.gold-=self.cost(k); self.levels[k]+=1
    def run(self):
        while True:
            dt=self.clock.tick(FPS)/1000
            for e in pygame.event.get():
                if e.type==pygame.QUIT: pygame.quit(); sys.exit()
                if e.type==pygame.KEYDOWN:
                    if e.key==pygame.K_ESCAPE:
                        if self.mode=='menu': pygame.quit(); sys.exit()
                        self.mode='menu'
                    elif self.mode=='menu':
                        if e.key==pygame.K_1: self.start('normal')
                        if e.key==pygame.K_2: self.start('blitz')
                        if e.key==pygame.K_3: self.start('endless')
                    elif self.mode=='prep' and e.key==pygame.K_RETURN: self.start_wave()
                    elif self.mode=='sea':
                        if e.key in [pygame.K_1,pygame.K_2,pygame.K_3,pygame.K_4,pygame.K_5]: self.shoot(e.key-pygame.K_1)
                        if e.key==pygame.K_q: self.ability('Q')
                        if e.key==pygame.K_w: self.ability('W')
                        if e.key==pygame.K_e: self.ability('E')
                        if e.key==pygame.K_r: self.ability('R')
                    elif self.mode=='result' and e.key==pygame.K_SPACE: self.mode='menu' if self.hp<=0 else 'prep'
                if e.type==pygame.MOUSEBUTTONDOWN:
                    if self.mode=='prep': self.click_upgrade(e.pos)
                    elif self.mode=='sea':
                        lane=int((e.pos[1]-TOP)/((BOT-TOP)/LANES))
                        if 0<=lane<LANES: self.shoot(lane)
            if self.mode=='sea': self.update_sea(dt)
            {'menu':self.draw_menu,'prep':self.draw_prep,'sea':self.draw_sea,'result':self.draw_result}[self.mode](); pygame.display.flip()

if __name__=='__main__': Game().run()
