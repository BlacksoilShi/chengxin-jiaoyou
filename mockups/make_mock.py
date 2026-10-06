from PIL import Image, ImageDraw, ImageFont
import math
A='/home/box/agent-data/agents/ea2f3e75-e7f4-4fb9-a8ef-20539472b669/attachments/'
OUT='/workspace/x-oneway-highlight/mockups/'
FR='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
FB='/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
S=2
def F(sz,b=False): return ImageFont.truetype(FB if b else FR, sz*S, index=2)  # SC
ORANGE=(244,93,34,255)

def pill(d,x,y,text,kind='has'):
    f=F(11,True); x*=S;y*=S
    w=d.textlength(text,font=f)+14*S; h=17*S
    if kind=='has':
        d.rounded_rectangle([x,y,x+w,y+h],radius=h//2,fill=(0,186,124,45),outline=(0,150,100,255),width=S)
        d.text((x+7*S,y+h/2),text,font=f,fill=(0,115,78,255),anchor='lm')
    else:
        d.rounded_rectangle([x,y,x+w,y+h],radius=h//2,fill=(240,243,245,200))
        # dashed outline
        r=h/2; pts=[]
        for i in range(0,int(w-h)+1,S): pts += [(x+r+i,y),(x+r+i,y+h)]
        for k,(px,py) in enumerate(pts):
            if (int((px-x))//(4*S))%2==0: d.point((px,py),fill=(150,160,170,255))
        d.arc([x,y,x+h,y+h],90,270,fill=(150,160,170,255),width=S)
        d.arc([x+w-h,y,x+w,y+h],270,90,fill=(150,160,170,255),width=S)
        d.text((x+7*S,y+h/2),text,font=f,fill=(130,140,150,255),anchor='lm')
    return (x/S,y/S,(x+w)/S,(y+h)/S)

def arrow(d,p1,p2):
    (x1,y1),(x2,y2)=[(a*S,b*S) for a,b in (p1,p2)]
    d.line([x1,y1,x2,y2],fill=ORANGE,width=2*S)
    ang=math.atan2(y2-y1,x2-x1); L=7*S
    for s in (0.45,-0.45):
        d.line([x2,y2,x2-L*math.cos(ang+s),y2-L*math.sin(ang+s)],fill=ORANGE,width=2*S)

def label(d,x,y,lines):
    f=F(11); x*=S;y*=S
    w=max(d.textlength(t,font=f) for t in lines)+12*S; h=(len(lines)*16+6)*S
    d.rounded_rectangle([x,y,x+w,y+h],radius=5*S,fill=(255,247,240,235),outline=ORANGE,width=S)
    for i,t in enumerate(lines): d.text((x+6*S,y+3*S+i*16*S),t,font=f,fill=(190,60,10,255))
    return (x/S,y/S,(x+w)/S,(y+h)/S)

def tooltip(d,x,y,text):
    f=F(11); x*=S;y*=S
    w=d.textlength(text,font=f)+12*S; h=20*S
    d.rounded_rectangle([x,y,x+w,y+h],radius=4*S,fill=(40,44,52,235))
    d.text((x+6*S,y+h/2),text,font=f,fill=(255,255,255,255),anchor='lm')

def corner(d,W,H):
    f=F(10); t='示意 · 非真实数据'
    w=d.textlength(t,font=f)+10*S
    d.rounded_rectangle([W-w-4*S,H-18*S,W-4*S,H-3*S],radius=4*S,fill=(255,235,59,230))
    d.text((W-w/2-4*S,H-10.5*S),t,font=f,fill=(90,70,0,255),anchor='mm')

def run(src,dst,fn):
    im=Image.open(A+src).convert('RGBA'); im=im.resize((im.width*S,im.height*S),Image.LANCZOS)
    ov=Image.new('RGBA',im.size,(0,0,0,0)); d=ImageDraw.Draw(ov)
    fn(d); corner(d,*im.size)
    Image.alpha_composite(im,ov).convert('RGB').save(OUT+dst); print(dst,im.size)

def m1(d):
    p=pill(d,278,95,'互动 12')
    l=label(d,345,70,['新增：互动 N（灰绿胶囊）','紧跟「关注了你」，悬停看分项'])
    arrow(d,(l[0],l[3]-6),(p[2]+2,p[1]+8))
    tooltip(d,505,122,'悬停：回复 5 · 点赞 4 · 转帖 2 · 引用 1')
run('70c38e9a080589e9b9396e4de9e50e40d9de7f160c98b6de817e2fb609e7ce1e.png','mock-01-list.png',m1)

def m2(d):
    p=pill(d,284,108,'暂无',kind='none')
    l=label(d,345,126,['无记录：淡虚线「暂无」','（安装后本机未累计到互动）'])
    arrow(d,(l[0],l[1]+10),(p[2]+2,p[1]+10))
run('0549c00b7b584451660ea0e9ef2a7897b74ea7a0a15cdb4a47b3b3941760dd37.png','mock-02-list.png',m2)

def m3(d):
    p=pill(d,274,98,'互动 3')
    l=label(d,345,74,['与「未回关/蓝V待回关」并存：','单向标靠名字，互动标靠 handle 行'])
    arrow(d,(l[0],p[1]+8),(p[2]+2,p[1]+8))
run('01daa4675365868d46ef27faf0fa8cc84a5cf1aec6e12106fe32a8ec9d732406.png','mock-03-list.png',m3)

def m4(d):
    p=pill(d,302,38,'互动 7')
    l=label(d,250,80,['刷帖时间线：插在「@handle · 时间」之后、','右侧 ⋯ 之前；只标发帖作者（不标引用卡）','悬停 title：回复 2 · 点赞 3 · 转帖 1 · 引用 1'])
    arrow(d,(p[0]+28,l[1]),(p[0]+28,p[3]+2))
run('4d1973ed3cd1df41af91ca56d1718cd46c84b73af60bb8334596035e907bc01c.png','mock-04-timeline.png',m4)
