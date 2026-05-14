import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { clsx, type ClassValue } from 'clsx';
import { motion, AnimatePresence } from 'motion/react';
import { Download, FileVideo, Fingerprint, Info, Activity, Layers, UploadCloud, FileAudio, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('جارِ تهيئة محرك البصمة الرقمية...');
  const [errorMsg, setErrorMsg] = useState('');
  
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  // Settings
  const [settings, setSettings] = useState({
    metadataStrip: true,
    visualCamouflage: true,
    temporalShift: true,
    audioScrambling: true,
    flipVideo: false,
    filmGrain: true,
    framerateJitter: true,
    audioEQ: true,
    trimEdges: true,
    sceneScrambling: true,
    vignette: true,
  });

  const ffmpegRef = useRef(new FFmpeg());
  const messageRef = useRef<HTMLDivElement>(null);

  const isLoadedRef = useRef(false);

  useEffect(() => {
    const load = async () => {
      if (isLoadedRef.current) return;
      isLoadedRef.current = true;

      try {
        const ffmpeg = ffmpegRef.current;
        ffmpeg.on('log', ({ message }) => {
          console.log('[FFmpeg]', message);
          setLogs(prev => [...prev.slice(-30), message]);
          if (message.toLowerCase().includes('error')) {
            console.error(message);
          }
        });
        
        ffmpeg.on('progress', ({ progress, time }) => {
          setProgress(Math.max(0, Math.min(100, Math.round(progress * 100))));
        });

        // Use a timeout to detect if loading hangs
        let isActuallyReady = false;
        let hangState = 'fetching core';
        const loadTimeout = setTimeout(() => {
          if (!isActuallyReady) {
            setErrorMsg(`يبدو أن عملية البدء تستغرق وقتاً طويلاً في مرحلة: ${hangState}. قد يكون اتصال الإنترنت بطيئاً. يرجى الانتظار أو إعادة تحميل الصفحة.`);
          }
        }, 15000);

        const cdnBaseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';

        setLoadingMsg('جاري تحميل المكتبات الأساسية (الرجاء الانتظار)...');
        const coreURL = await toBlobURL(`${cdnBaseURL}/ffmpeg-core.js`, 'text/javascript');
        
        hangState = 'fetching wasm';
        setLoadingMsg('جاري تحميل محرك التشفير الضخم (~30MB)، قد يستغرق دقيقة...');
        const wasmURL = await toBlobURL(`${cdnBaseURL}/ffmpeg-core.wasm`, 'application/wasm');
        
        hangState = 'loading ffmpeg';
        setLoadingMsg('جاري بدء تشغيل المحرك...');
        await ffmpeg.load({
          coreURL,
          wasmURL,
        });
        
        isActuallyReady = true;
        clearTimeout(loadTimeout);
        setLoaded(true);
        setLoadingMsg('جاهز');
      } catch (err: any) {
        console.error('FFmpeg Load Error:', err);
        setErrorMsg('فشل محرك المعالجة في البدء. السبب: ' + (err.message || 'خطأ غير معروف') + '. يرجى تحديث الصفحة.');
        isLoadedRef.current = false;
      }
    };

    load();
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.size > 100 * 1024 * 1024) { // 100MB max 
        alert('حجم الملف كبير جداً. يرجى اختيار فيديو بحجم أقل من 100 ميجابايت لضمان المعالجة السلسة في المتصفح.');
        return;
      }
      setVideoFile(file);
      const url = URL.createObjectURL(file);
      setVideoPreview(url);
      setProcessedUrl(null);
      setProgress(0);

      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        setVideoDuration(video.duration);
      };
      video.src = url;
    }
  };

  const processVideo = async () => {
    if (!videoFile || !loaded) return;

    try {
      setIsProcessing(true);
      setProgress(0);
      setProcessedUrl(null);
      setErrorMsg('');
      setLogs([]);
      
      const ffmpeg = ffmpegRef.current;
      await ffmpeg.writeFile('input.mp4', await fetchFile(videoFile));

      // Fast check if audio exists to prevent stream mapping errors
      let hasAudio = true;
      const probeLogs: string[] = [];
      const probeLogger = ({ message }: { message: string }) => probeLogs.push(message);
      ffmpeg.on('log', probeLogger);
      try {
        await ffmpeg.exec(['-i', 'input.mp4']);
      } catch (e) {
        // Expected because no output file
      }
      ffmpeg.off('log', probeLogger);
      hasAudio = probeLogs.some(log => log.includes('Audio:'));
      console.log('Detected Audio:', hasAudio);

      const localExecLogs: string[] = [];
      const execLogger = ({ message }: { message: string }) => localExecLogs.push(message);
      ffmpeg.on('log', execLogger);

      const args: string[] = [];
      
      if (settings.trimEdges && videoDuration > 1.0) {
        args.push('-ss', '0.2');
        args.push('-to', (videoDuration - 0.2).toFixed(3));
      }
      
      args.push('-i', 'input.mp4');

      // Optimize for web assembly processing
      args.push('-c:v', 'libx264');
      args.push('-preset', 'ultrafast');
      args.push('-crf', '26');

      if (settings.framerateJitter) {
        args.push('-r', '30.01'); // Force output to 30.01 FPS to ruin frame alignment
      }

      if (settings.metadataStrip) {
        args.push('-map_metadata', '-1');
        args.push('-fflags', '+bitexact');
        args.push('-g', '35'); // Custom GOP Structure
        args.push('-video_track_timescale', '90000');
      }

      let filterGraph: string[] = [];
      let maps: string[] = [];

      let vfilters = "";
      let afilters = "";

      if (settings.visualCamouflage) {
        vfilters += "eq=contrast=1.01:brightness=0.005:saturation=1.02,scale=trunc((iw*1.01)/2)*2:trunc((ih*1.01)/2)*2,crop=trunc(iw/1.01/2)*2:trunc(ih/1.01/2)*2,drawbox=x=0:y=0:w=10:h=10:color=black@0.01:t=fill";
      }

      if (settings.vignette) {
        if (vfilters) vfilters += ",";
        vfilters += "vignette=a=PI/8";
      }

      if (settings.flipVideo) {
        if (vfilters) vfilters += ",";
        vfilters += "hflip";
      }

      if (settings.filmGrain) {
        if (vfilters) vfilters += ",";
        vfilters += "noise=alls=2:allf=t+u"; // 2% dynamic noise to disrupt pHash
      }

      if (settings.temporalShift) {
        if (vfilters) vfilters += ",";
        vfilters += "setpts=0.995*PTS";
        afilters += "atempo=1.005025";
      }

      if (settings.sceneScrambling) {
        if (vfilters) vfilters += ",";
        vfilters += "setpts=PTS*(1.001+0.002*sin(N/60))";
      }

      if (hasAudio) {
        if (settings.audioScrambling) {
          if (afilters) afilters += ",";
          afilters += "asetrate=48000*1.01,aresample=48000";
        }
  
        if (settings.audioEQ) {
          if (afilters) afilters += ",";
          afilters += "equalizer=f=1000:width_type=h:width=200:g=-1.5,bass=g=1.5,treble=g=1.5";
        }
      }

      if (vfilters) {
        filterGraph.push(`[0:v]${vfilters}[vout]`);
        maps.push('-map', '[vout]');
      } else {
        maps.push('-map', '0:v');
      }

      if (hasAudio) {
        if (afilters) {
          filterGraph.push(`[0:a]${afilters}[aout]`);
          maps.push('-map', '[aout]');
        } else {
          // Use optional map just in case probe was inaccurate
          maps.push('-map', '0:a?');
        }
      }

      if (filterGraph.length > 0) {
        args.push('-filter_complex', filterGraph.join(';'));
      }
      
      args.push(...maps);
      if (hasAudio) {
        args.push('-c:a', 'aac');
        args.push('-b:a', '128k');
      }
      args.push('output.mp4');

      console.log('Executing FFmpeg with args:', args.join(' '));
      
      const result = await ffmpeg.exec(args);
      ffmpeg.off('log', execLogger);
      
      if (result !== 0) {
        console.error('FFmpeg Execution Failed. End of logs:\n', localExecLogs.slice(-20).join('\n'));
        throw new Error('فشلت عملية التشفير خلال التنفيذ.');
      }

      const data = await ffmpeg.readFile('output.mp4');
      const url = URL.createObjectURL(new Blob([data.buffer as Uint8Array].slice(), { type: 'video/mp4' }));
      
      setProcessedUrl(url);
      
    } catch (err: any) {
      console.error(err);
      setErrorMsg('حدث خطأ أثناء المعالجة: ' + (err.message || String(err)));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-cyan-900 selection:text-cyan-50" dir="rtl">
      {/* Background gradients */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-cyan-900/10 via-zinc-950 to-zinc-950"></div>
      
      {/* Header */}
      <header className="relative border-b border-white/5 bg-zinc-900/50 backdrop-blur-xl z-10">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.3)]">
              <Fingerprint className="w-6 h-6 text-zinc-950" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">PhantomVideo</h1>
              <p className="text-xs text-cyan-400 font-medium">نظام التمويه وتغيير البصمة الرقمية المتقدم</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 text-xs font-mono">
            {loaded ? (
              <span className="flex items-center gap-2 text-emerald-400 bg-emerald-400/10 px-3 py-1.5 rounded-full border border-emerald-400/20">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                النظام جاهز ومُؤمن
              </span>
            ) : errorMsg ? (
              <span className="flex items-center gap-2 text-red-400 bg-red-400/10 px-3 py-1.5 rounded-full border border-red-400/20">
                <AlertTriangle className="w-3.5 h-3.5" />
                خطأ في التهيئة
              </span>
            ) : (
              <span className="flex items-center gap-2 text-amber-400 bg-amber-400/10 px-3 py-1.5 rounded-full border border-amber-400/20">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                {loadingMsg}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-6 py-10 flex flex-col lg:flex-row gap-8 items-start">
        {/* Right Column - Controls (Since RTL) */}
        <div className="w-full lg:w-1/3 flex flex-col gap-6">
          
          <div className="bg-zinc-900/60 border border-white/5 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
                <Layers className="w-5 h-5 text-cyan-400" />
                إعدادات التمويه
              </h2>
            </div>

            <div className="space-y-4">
              <label className={cn(
                "flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer",
                settings.metadataStrip ? "bg-cyan-500/5 border-cyan-500/30" : "bg-black/20 border-white/5 hover:border-white/10"
              )}>
                <div className="relative flex items-center justify-center mt-0.5">
                  <input type="checkbox" className="sr-only" 
                    checked={settings.metadataStrip}
                    onChange={(e) => setSettings(s => ({...s, metadataStrip: e.target.checked}))}
                  />
                  <div className={cn("w-5 h-5 rounded flex items-center justify-center border", settings.metadataStrip ? "bg-cyan-500 border-cyan-500" : "border-zinc-700 bg-zinc-800")}>
                    {settings.metadataStrip && <CheckCircle2 className="w-3.5 h-3.5 text-zinc-950" />}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-white mb-1">الهندسة الرقمية للبيانات (Metadata)</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">يمسح بيانات الكاميرا، يخفي التوقيتات، يغير UUID ويعيد تنظيم بنية (GOP) الداخلية لتغيير البصمة البرمجية كلياً.</p>
                </div>
              </label>

              <label className={cn(
                "flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer",
                settings.visualCamouflage ? "bg-cyan-500/5 border-cyan-500/30" : "bg-black/20 border-white/5 hover:border-white/10"
              )}>
                <div className="relative flex items-center justify-center mt-0.5">
                  <input type="checkbox" className="sr-only" 
                    checked={settings.visualCamouflage}
                    onChange={(e) => setSettings(s => ({...s, visualCamouflage: e.target.checked}))}
                  />
                  <div className={cn("w-5 h-5 rounded flex items-center justify-center border", settings.visualCamouflage ? "bg-cyan-500 border-cyan-500" : "border-zinc-700 bg-zinc-800")}>
                    {settings.visualCamouflage && <CheckCircle2 className="w-3.5 h-3.5 text-zinc-950" />}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-white mb-1">التمويه البصري المجهري (Visual)</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">تكبير وقص مجهري بدقة 1٪، لتدمير تطابق البيكسلات، وتطبيق طبقة لونية وتعتيم بصري دقيق يكسر خوارزميات الرؤية الحاسوبية.</p>
                </div>
              </label>

              <label className={cn(
                "flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer",
                settings.temporalShift ? "bg-cyan-500/5 border-cyan-500/30" : "bg-black/20 border-white/5 hover:border-white/10"
              )}>
                <div className="relative flex items-center justify-center mt-0.5">
                  <input type="checkbox" className="sr-only" 
                    checked={settings.temporalShift}
                    onChange={(e) => setSettings(s => ({...s, temporalShift: e.target.checked}))}
                  />
                  <div className={cn("w-5 h-5 rounded flex items-center justify-center border", settings.temporalShift ? "bg-cyan-500 border-cyan-500" : "border-zinc-700 bg-zinc-800")}>
                    {settings.temporalShift && <CheckCircle2 className="w-3.5 h-3.5 text-zinc-950" />}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-white mb-1">التلاعب الزمني (Temporal)</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">تغيّر سرعة التوقيت الداخلي للإطارات (Speed Ramping) بنسبة 0.05٪ وتوليف مسار الصوت لمطابقته لمنع تطابق التوقيت.</p>
                </div>
              </label>

              <label className={cn(
                "flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer",
                settings.audioScrambling ? "bg-cyan-500/5 border-cyan-500/30" : "bg-black/20 border-white/5 hover:border-white/10"
              )}>
                <div className="relative flex items-center justify-center mt-0.5">
                  <input type="checkbox" className="sr-only" 
                    checked={settings.audioScrambling}
                    onChange={(e) => setSettings(s => ({...s, audioScrambling: e.target.checked}))}
                  />
                  <div className={cn("w-5 h-5 rounded flex items-center justify-center border", settings.audioScrambling ? "bg-cyan-500 border-cyan-500" : "border-zinc-700 bg-zinc-800")}>
                    {settings.audioScrambling && <CheckCircle2 className="w-3.5 h-3.5 text-zinc-950" />}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-white mb-1">تشويه البصمة الصوتية (Audio)</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">تكسير تردد الموجة الصوتية وإزاحة النبرة بنسبة لا تلتقطها أذن المستخدم العادي لتخطي بصمات الصوت الثابتة.</p>
                </div>
              </label>

              <label className={cn(
                "flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer",
                settings.audioEQ ? "bg-cyan-500/5 border-cyan-500/30" : "bg-black/20 border-white/5 hover:border-white/10"
              )}>
                <div className="relative flex items-center justify-center mt-0.5">
                  <input type="checkbox" className="sr-only" 
                    checked={settings.audioEQ}
                    onChange={(e) => setSettings(s => ({...s, audioEQ: e.target.checked}))}
                  />
                  <div className={cn("w-5 h-5 rounded flex items-center justify-center border", settings.audioEQ ? "bg-cyan-500 border-cyan-500" : "border-zinc-700 bg-zinc-800")}>
                    {settings.audioEQ && <CheckCircle2 className="w-3.5 h-3.5 text-zinc-950" />}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-white mb-1">إعادة تشكيل الترددات (Audio EQ)</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">تضخيم وإضعاف ترددات معينة (Bass/Treble) لإنتاج شكل موجة صوتية هجينة يصعب على خوارزميات تطابق الصوت رصدها.</p>
                </div>
              </label>

              <label className={cn(
                "flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer",
                settings.trimEdges ? "bg-cyan-500/5 border-cyan-500/30" : "bg-black/20 border-white/5 hover:border-white/10"
              )}>
                <div className="relative flex items-center justify-center mt-0.5">
                  <input type="checkbox" className="sr-only" 
                    checked={settings.trimEdges}
                    onChange={(e) => setSettings(s => ({...s, trimEdges: e.target.checked}))}
                  />
                  <div className={cn("w-5 h-5 rounded flex items-center justify-center border", settings.trimEdges ? "bg-cyan-500 border-cyan-500" : "border-zinc-700 bg-zinc-800")}>
                    {settings.trimEdges && <CheckCircle2 className="w-3.5 h-3.5 text-zinc-950" />}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-white mb-1">قص الأطراف المجهري (Trim/Cut)</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">قص جزء ضئيل جداً (0.2 ثانية) من بداية ونهاية الفيديو لتغيير الطول الإجمالي للملف بالمللي ثانية، مما يفشل التطابق الزمني الكلي.</p>
                </div>
              </label>

              <label className={cn(
                "flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer",
                settings.sceneScrambling ? "bg-cyan-500/5 border-cyan-500/30" : "bg-black/20 border-white/5 hover:border-white/10"
              )}>
                <div className="relative flex items-center justify-center mt-0.5">
                  <input type="checkbox" className="sr-only" 
                    checked={settings.sceneScrambling}
                    onChange={(e) => setSettings(s => ({...s, sceneScrambling: e.target.checked}))}
                  />
                  <div className={cn("w-5 h-5 rounded flex items-center justify-center border", settings.sceneScrambling ? "bg-cyan-500 border-cyan-500" : "border-zinc-700 bg-zinc-800")}>
                    {settings.sceneScrambling && <CheckCircle2 className="w-3.5 h-3.5 text-zinc-950" />}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-white mb-1">تشتيت نقاط المشهد (Scene Scrambling)</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">تغيير سرعة الإطارات بشكل متأرجح ومتموج عبر الفيديو لتدمير القياسات الزمنية بين الانتقالات (Cuts) والمقاطع.</p>
                </div>
              </label>

              <label className={cn(
                "flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer",
                settings.vignette ? "bg-cyan-500/5 border-cyan-500/30" : "bg-black/20 border-white/5 hover:border-white/10"
              )}>
                <div className="relative flex items-center justify-center mt-0.5">
                  <input type="checkbox" className="sr-only" 
                    checked={settings.vignette}
                    onChange={(e) => setSettings(s => ({...s, vignette: e.target.checked}))}
                  />
                  <div className={cn("w-5 h-5 rounded flex items-center justify-center border", settings.vignette ? "bg-cyan-500 border-cyan-500" : "border-zinc-700 bg-zinc-800")}>
                    {settings.vignette && <CheckCircle2 className="w-3.5 h-3.5 text-zinc-950" />}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-white mb-1">التعتيم المحيطي الطفيف (Vignette)</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">تدريج ظل أسود خفيف جداً على الأطراف لهندسة وتقسيم إضاءة المشهد الكلية لمنع التطابق اللوني.</p>
                </div>
              </label>
              <label className={cn(
                "flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer",
                settings.filmGrain ? "bg-cyan-500/5 border-cyan-500/30" : "bg-black/20 border-white/5 hover:border-white/10"
              )}>
                <div className="relative flex items-center justify-center mt-0.5">
                  <input type="checkbox" className="sr-only" 
                    checked={settings.filmGrain}
                    onChange={(e) => setSettings(s => ({...s, filmGrain: e.target.checked}))}
                  />
                  <div className={cn("w-5 h-5 rounded flex items-center justify-center border", settings.filmGrain ? "bg-cyan-500 border-cyan-500" : "border-zinc-700 bg-zinc-800")}>
                    {settings.filmGrain && <CheckCircle2 className="w-3.5 h-3.5 text-zinc-950" />}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-white mb-1">حقن الضوضاء الديناميكية (Film Grain)</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">إضافة طبقة تشويش ديناميكية متغيرة في كل إطار (Noise) لتدمير التجزئة البصرية (pHash) وخوارزميات مطابقة الأسطح.</p>
                </div>
              </label>

              <label className={cn(
                "flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer",
                settings.flipVideo ? "bg-cyan-500/5 border-cyan-500/30" : "bg-black/20 border-white/5 hover:border-white/10"
              )}>
                <div className="relative flex items-center justify-center mt-0.5">
                  <input type="checkbox" className="sr-only" 
                    checked={settings.flipVideo}
                    onChange={(e) => setSettings(s => ({...s, flipVideo: e.target.checked}))}
                  />
                  <div className={cn("w-5 h-5 rounded flex items-center justify-center border", settings.flipVideo ? "bg-cyan-500 border-cyan-500" : "border-zinc-700 bg-zinc-800")}>
                    {settings.flipVideo && <CheckCircle2 className="w-3.5 h-3.5 text-zinc-950" />}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-white mb-1">الانعكاس الأفقي (Horizontal Flip)</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">عكس الفيديو من اليمين لليسار. فعال جداً ضد التعرف على الوجوه والنصوص والـ Spatial Hashing (قد يعكس النصوص الموجودة بالفيديو).</p>
                </div>
              </label>

              <label className={cn(
                "flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer",
                settings.framerateJitter ? "bg-cyan-500/5 border-cyan-500/30" : "bg-black/20 border-white/5 hover:border-white/10"
              )}>
                <div className="relative flex items-center justify-center mt-0.5">
                  <input type="checkbox" className="sr-only" 
                    checked={settings.framerateJitter}
                    onChange={(e) => setSettings(s => ({...s, framerateJitter: e.target.checked}))}
                  />
                  <div className={cn("w-5 h-5 rounded flex items-center justify-center border", settings.framerateJitter ? "bg-cyan-500 border-cyan-500" : "border-zinc-700 bg-zinc-800")}>
                    {settings.framerateJitter && <CheckCircle2 className="w-3.5 h-3.5 text-zinc-950" />}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-white mb-1">ذبذبة معدل الإطارات (Framerate Jitter)</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">إجبار الفيديو على معدل إطارات غير قياسي (مثلاً 30.01 FPS) لتدمير التزامن مع الإطارات الأصلية ومنع التطابق الحركي.</p>
                </div>
              </label>

              <label className={cn(
                "flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer",
                settings.audioEQ ? "bg-cyan-500/5 border-cyan-500/30" : "bg-black/20 border-white/5 hover:border-white/10"
              )}>
                <div className="relative flex items-center justify-center mt-0.5">
                  <input type="checkbox" className="sr-only" 
                    checked={settings.audioEQ}
                    onChange={(e) => setSettings(s => ({...s, audioEQ: e.target.checked}))}
                  />
                  <div className={cn("w-5 h-5 rounded flex items-center justify-center border", settings.audioEQ ? "bg-cyan-500 border-cyan-500" : "border-zinc-700 bg-zinc-800")}>
                    {settings.audioEQ && <CheckCircle2 className="w-3.5 h-3.5 text-zinc-950" />}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-white mb-1">إعادة تشكيل الترددات (Audio EQ)</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">تضخيم وإضعاف ترددات معينة (Bass/Treble) لإنتاج شكل موجة صوتية هجينة يصعب على خوارزميات تطابق الصوت رصدها.</p>
                </div>
              </label>
            </div>
            
            <div className="mt-6 pt-6 border-t border-white/5">
              <p className="text-[10px] text-zinc-500 leading-relaxed bg-black/20 p-3 rounded-lg flex items-start gap-2">
                <Info className="w-4 h-4 shrink-0 text-cyan-700" />
                تتم جميع عمليات الهندسة والتشفير محلياً في متصفحك. لا يتم رفع ملفاتك لأي خوادم خارجية لضمان السرية التامة ولتجاوز رقابة الشبكات.
              </p>
            </div>
          </div>
        </div>

        {/* Left Column - Processing Area */}
        <div className="w-full lg:w-2/3 flex flex-col gap-6">
          {errorMsg && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <p className="text-sm">{errorMsg}</p>
            </div>
          )}

          <div className="bg-zinc-900/60 border border-white/5 rounded-2xl overflow-hidden shadow-xl flex flex-col h-full min-h-[500px]">
            {/* Upload Area */}
            {!videoFile && (
              <label className="flex-1 flex flex-col items-center justify-center p-12 cursor-pointer hover:bg-white/5 transition-colors group relative overflow-hidden">
                <div className="w-20 h-20 bg-zinc-800/80 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 shadow-[0_0_30px_rgba(0,0,0,0.5)]">
                  <UploadCloud className="w-10 h-10 text-cyan-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">إسقاط فيديو لتشفيره</h3>
                <p className="text-sm text-zinc-400 text-center max-w-sm mb-6">يدعم MP4 الأصلي، سيتم تغيير البصمة كلياً لضمان عدم الاكتشاف (ينصح بملفات تحت 50 ميجا للسرعة)</p>
                
                <span className="px-6 py-2.5 rounded-lg bg-white/10 text-white text-sm font-medium border border-white/10 group-hover:bg-white/15 transition-colors">
                  تصفح الملفات
                </span>
                <input type="file" accept="video/mp4,video/quicktime,video/x-m4v" className="hidden" onChange={handleFileUpload} />
              </label>
            )}

            {/* Video File Overview & Actions */}
            {videoFile && !isProcessing && !processedUrl && (
              <div className="flex-1 flex flex-col">
                <div className="p-6 border-b border-white/5 flex items-start justify-between bg-black/20">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-zinc-800 flex items-center justify-center">
                      <FileVideo className="w-6 h-6 text-zinc-400" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-white max-w-[250px] truncate" dir="ltr">{videoFile.name}</h3>
                      <p className="text-xs text-cyan-400 pt-1">
                        {(videoFile.size / (1024 * 1024)).toFixed(2)} MB • جاهز للمعالجة
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={() => { setVideoFile(null); setVideoPreview(null); }}
                    className="text-xs text-zinc-400 hover:text-white transition-colors"
                  >
                    إلغاء وإعادة الرفع
                  </button>
                </div>
                
                <div className="flex-1 p-6 flex flex-col justify-center items-center">
                   {videoPreview && (
                     <div className="w-full max-w-lg aspect-video rounded-xl overflow-hidden bg-black border border-white/10 relative shadow-2xl">
                       <video src={videoPreview} controls className="w-full h-full object-contain opacity-70" />
                       <div className="absolute inset-0 pointer-events-none opacity-20 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]" />
                     </div>
                   )}
                </div>

                <div className="p-6 bg-zinc-950/50 border-t border-white/5 flex justify-between items-center gap-4">
                  <div className="text-xs font-mono text-zinc-500">
                    {!loaded && !errorMsg && loadingMsg}
                    {errorMsg && <span className="text-red-400 font-sans">{errorMsg}</span>}
                  </div>
                  <button 
                    onClick={processVideo}
                    disabled={!loaded || isProcessing}
                    className="flex items-center gap-2 bg-gradient-to-l from-cyan-600 w-full sm:w-auto justify-center to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white px-8 py-3.5 rounded-xl font-bold shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Activity className="w-5 h-5" />
                    {isProcessing ? 'جاري المعالجة...' : 'بدء تشفير وتغيير بصمة الفيديو'}
                  </button>
                </div>
              </div>
            )}

            {/* Processing State */}
            {isProcessing && (
              <div className="flex-1 flex flex-col items-center justify-center p-12 relative overflow-hidden">
                <div className="absolute inset-0 bg-cyan-900/10 animate-pulse pointer-events-none" />
                
                <div className="relative z-10 w-full max-w-md">
                   <div className="mb-12 flex justify-center">
                     <div className="relative">
                       <div className="w-24 h-24 rounded-full border-4 border-zinc-800 border-t-cyan-400 border-r-emerald-400 animate-spin" />
                       <div className="absolute inset-0 flex items-center justify-center">
                         <Fingerprint className="w-8 h-8 text-cyan-400 animate-pulse" />
                       </div>
                     </div>
                   </div>

                   <h3 className="text-xl font-bold text-center text-white mb-2">جاري حقن التغييرات...</h3>
                   <p className="text-sm font-mono text-cyan-400/80 text-center mb-8 flex justify-center gap-2 items-center" dir="ltr">
                     {progress}% <span className="opacity-50">|</span> OVERWRITING FINGERPRINT
                   </p>

                   <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                     <div 
                       className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all duration-300 ease-out"
                       style={{ width: `${progress}%` }}
                     />
                   </div>

                   <div className="mt-8 space-y-3">
                     {[
                       { condition: settings.metadataStrip, text: "تدمير البيانات الوصفية وهيكل الحاوية..." },
                       { condition: settings.trimEdges, text: "تدمير الطول الزمني الدقيق للفيلم..." },
                       { condition: settings.visualCamouflage, text: "تطبيق القص والتطوير المجهري للبصمة البصرية..." },
                       { condition: settings.filmGrain, text: "حقن مجالات عشوائية وميكرو-تشويش..." },
                       { condition: settings.vignette, text: "تشتيت الإضاءة الهندسية وتخفيف الأطراف..." },
                       { condition: settings.flipVideo, text: "عكس هيكلة المشهد بصرياً (Flip)..." },
                       { condition: settings.sceneScrambling, text: "تشتيت الفواصل الزمنية بين المشاهد (Scene Scrambling)..." },
                       { condition: settings.temporalShift, text: "إحداث ذبذبة وإزاحة للشبكة الزمنية للإطارات..." },
                       { condition: settings.framerateJitter, text: "كسر التوافق الزمني لمعدل الإطارات (FPS)..." },
                       { condition: settings.audioScrambling, text: "تغيير العينة وتردد الموجة الصوتية..." },
                       { condition: settings.audioEQ, text: "إعادة هندسة الموازنة الصوتية وطبقات التردد (EQ)..." }
                     ].map((step, i) => step.condition && (
                        <div key={i} className="flex items-center gap-3 text-xs text-zinc-500 font-mono animate-pulse delay-100">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/50" />
                          {step.text}
                        </div>
                     ))}
                   </div>

                   {/* Terminal Simulator for Logs */}
                   <div className="mt-8 bg-black/60 p-4 rounded-xl border border-white/5 w-full h-32 overflow-y-auto font-mono text-[10px] text-zinc-500 text-left flex flex-col gap-1" dir="ltr">
                     {logs.length === 0 && <span className="animate-pulse">Waiting for WebAssembly engine to start...</span>}
                     {logs.map((log, i) => (
                       <span key={i} className="whitespace-pre-wrap">{log}</span>
                     ))}
                   </div>
                </div>
              </div>
            )}

            {/* Results State */}
            {processedUrl && !isProcessing && (
              <div className="flex-1 flex flex-col bg-zinc-900/60">
                <div className="p-6 border-b border-emerald-500/20 bg-emerald-500/5 flex items-center justify-center gap-3 text-emerald-400">
                  <CheckCircle2 className="w-6 h-6" />
                  <h3 className="text-lg font-bold">تم تغيير بصمة الفيديو واجتياز التشفير بنجاح!</h3>
                </div>

                <div className="flex-1 p-6 flex flex-col justify-center items-center">
                   <div className="w-full max-w-lg aspect-video rounded-xl overflow-hidden bg-black border border-white/10 relative shadow-2xl">
                     <video src={processedUrl} controls className="w-full h-full object-contain" />
                     {/* Overlay effect to show it's stealthy */}
                     <div className="absolute top-4 left-4 flex gap-2">
                       <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-1 rounded shadow-lg flex gap-1 items-center">
                         <Activity className="w-3 h-3" />
                         STEALTHED
                       </span>
                     </div>
                   </div>
                </div>

                <div className="p-6 border-t border-white/5 flex items-center justify-between bg-black/20">
                  <button 
                    onClick={() => {
                      setProcessedUrl(null);
                      setVideoFile(null);
                      setVideoPreview(null);
                      setProgress(0);
                    }}
                    className="text-sm text-zinc-400 hover:text-white transition-colors"
                  >
                    تشفير فيديو آخر
                  </button>
                  <a 
                    href={processedUrl}
                    download={`phantom_${videoFile?.name || 'video.mp4'}`}
                    className="flex items-center gap-2 bg-white text-zinc-950 px-6 py-3 rounded-lg font-bold hover:bg-zinc-200 transition-colors shadow-lg"
                  >
                    <Download className="w-4 h-4" />
                    حفظ الفيديو المشفر
                  </a>
                </div>
              </div>
            )}

          </div>
        </div>
      </main>
    </div>
  );
}
