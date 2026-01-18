import { useEffect, useRef, useState, Component, ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Mic, MicOff, Video as CamOn, VideoOff, MonitorUp, PhoneOff } from 'lucide-react';

// Error boundary component
class CallErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('Call component error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-background via-card to-background">
          <Card className="w-full max-w-md p-8 space-y-6 bg-card/80 backdrop-blur-sm border-primary/20">
            <h1 className="text-2xl font-bold text-center">Call Error</h1>
            <p className="text-muted-foreground text-center">
              Something went wrong with the video call. Please refresh the page to try again.
            </p>
            <Button onClick={() => window.location.reload()} className="w-full">
              Refresh Page
            </Button>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

function Call() {
  const { partnerId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);

  // Media state
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);
  const [isSharing, setIsSharing] = useState(false);
  const [audioUnlockNeeded, setAudioUnlockNeeded] = useState(false);
  const [connectionState, setConnectionState] = useState<string>('new');

  // WebRTC
  const pcRef = useRef<RTCPeerConnection | null>(null); 
  const isInitiatorRef = useRef<boolean>(false);
  const rtcChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pendingRemoteIceRef = useRef<RTCIceCandidateInit[]>([]);

  // Chat
  const [messages, setMessages] = useState<Array<{ id: string; senderId: string; text: string; ts: number }>>([]);
  const [chatInput, setChatInput] = useState('');
  const chatChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    document.title = 'Live Call | Skill Share';
  }, []);

  useEffect(() => {
    // Get current user
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    // Setup local media
    const setupLocalMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          await localVideoRef.current.play().catch(() => {});
        }
      } catch (err) {
        console.error('Media access error:', err);
        toast({ title: 'Media error', description: 'Unable to access camera/microphone', variant: 'destructive' });
      }
    };
    setupLocalMedia();

    return () => {
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      remoteStreamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [toast]);

  const waitForLocalStream = async () => {
    while (!localStreamRef.current || localStreamRef.current.getTracks().length === 0) {
      await new Promise(r => setTimeout(r, 100));
    }
  };

  useEffect(() => {
    if (!userId || !partnerId) return;
    isInitiatorRef.current = userId < partnerId; // deterministic initiator
    const pairKey = [userId, partnerId].sort().join(':');

    const setupPeerConnection = async () => {
      await waitForLocalStream();

      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      pcRef.current = pc;

      // Add local tracks
      localStreamRef.current!.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current!));

      // Prepare remote stream
      remoteStreamRef.current = new MediaStream();
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStreamRef.current;

      // Handle remote tracks
      pc.ontrack = (event) => {
        event.streams[0]?.getTracks().forEach(track => remoteStreamRef.current!.addTrack(track));
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStreamRef.current;
          remoteVideoRef.current.play().catch(() => setAudioUnlockNeeded(true));
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          rtcChannelRef.current?.send({ type: 'broadcast', event: 'ice', payload: { candidate: event.candidate, senderId: userId } });
        }
      };

      pc.onconnectionstatechange = () => setConnectionState(pc.connectionState);

      // Signaling
      const rtcChannel = supabase.channel(`webrtc:${pairKey}`);
      rtcChannelRef.current = rtcChannel;

      rtcChannel
        .on('broadcast', { event: 'offer' }, async ({ payload }) => {
          const { sdp, type, senderId: sender } = payload as any;
          if (sender === userId) return;
          const offer = { sdp, type } as RTCSessionDescriptionInit;
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          pendingRemoteIceRef.current.forEach(async c => await pc.addIceCandidate(new RTCIceCandidate(c)));
          pendingRemoteIceRef.current = [];

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await rtcChannelRef.current?.send({ type: 'broadcast', event: 'answer', payload: { ...answer, senderId: userId } });
        })
        .on('broadcast', { event: 'answer' }, async ({ payload }) => {
          const { sdp, type, senderId: sender } = payload as any;
          if (sender === userId) return;
          const answer = { sdp, type } as RTCSessionDescriptionInit;
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          pendingRemoteIceRef.current.forEach(async c => await pc.addIceCandidate(new RTCIceCandidate(c)));
          pendingRemoteIceRef.current = [];
        })
        .on('broadcast', { event: 'ice' }, async ({ payload }) => {
          const { candidate, senderId: sender } = payload as any;
          if (sender === userId) return;
          if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(candidate));
          else pendingRemoteIceRef.current.push(candidate);
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED' && isInitiatorRef.current) {
            const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
            await pc.setLocalDescription(offer);
            await rtcChannelRef.current?.send({ type: 'broadcast', event: 'offer', payload: { ...offer, senderId: userId } });
          }
        });

      return () => {
        if (rtcChannelRef.current) supabase.removeChannel(rtcChannelRef.current);
        pcRef.current?.close();
        pcRef.current = null;
      };
    };

    setupPeerConnection();
  }, [userId, partnerId]);

  // Chat
  useEffect(() => {
    if (!userId || !partnerId) return;
    const pairKey = [userId, partnerId].sort().join(':');
    const channel = supabase.channel(`chat:${pairKey}`);
    chatChannelRef.current = channel;

    channel.on('broadcast', { event: 'message' }, (payload) => {
      setMessages(prev => [...prev, payload.payload as any]);
    }).subscribe();

    return () => {
      supabase.removeChannel(channel);
      chatChannelRef.current = null;
    };
  }, [userId, partnerId]);

  const sendChat = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || !userId) return;
    const msg = { id: crypto.randomUUID(), senderId: userId, text: trimmed, ts: Date.now() };
    setMessages(prev => [...prev, msg]);
    setChatInput('');
    try {
      await chatChannelRef.current?.send({ type: 'broadcast', event: 'message', payload: msg });
    } catch (_) {}
  };

  const endCall = async () => {
    try {
      await supabase.from('call_sessions').update({ status: 'ended', ended_at: new Date().toISOString() })
        .or(`user1_id.eq.${partnerId},user2_id.eq.${partnerId}`);
    } catch (_) {}
    toast({ title: 'Call ended' });
    navigate('/');
  };

  const toggleMic = () => {
    localStreamRef.current?.getAudioTracks().forEach(track => track.enabled = !track.enabled);
    setIsMicOn(prev => !prev);
  };

  const toggleCam = () => {
    localStreamRef.current?.getVideoTracks().forEach(track => track.enabled = !track.enabled);
    setIsCamOn(prev => !prev);
  };

  const toggleScreenShare = async () => {
    if (isSharing) {
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
      setIsSharing(false);
      return;
    }
    try {
      const screen = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = screen as MediaStream;
      setIsSharing(true);
    } catch (_) {}
  };

  const unlockAudio = async () => {
    if (remoteVideoRef.current) {
      await remoteVideoRef.current.play().catch(() => {});
      setAudioUnlockNeeded(false);
    }
  };

  return (
    <main className="min-h-screen p-6 bg-gradient-to-br from-background via-card to-background">
      <Card className="w-full max-w-6xl mx-auto p-4 md:p-6 bg-card/80 backdrop-blur-sm border-primary/20">
        <div className="flex items-center justify-between pb-4 border-b border-border/40">
          <div>
            <h1 className="text-xl md:text-2xl font-bold">Call with {partnerId}</h1>
            <p className="text-xs md:text-sm text-muted-foreground">Share skills, chat, and collaborate in real-time.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="icon" onClick={toggleMic}>{isMicOn ? <Mic /> : <MicOff />}</Button>
            <Button variant="secondary" size="icon" onClick={toggleCam}>{isCamOn ? <CamOn /> : <VideoOff />}</Button>
            <Button variant="secondary" size="icon" onClick={toggleScreenShare}><MonitorUp /></Button>
            <Button variant="destructive" onClick={endCall} className="gap-2"><PhoneOff />End</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
          <div className="md:col-span-2 relative rounded-lg overflow-hidden bg-black aspect-video">
            <video ref={remoteVideoRef} className="h-full w-full object-cover" playsInline autoPlay />
            <video ref={localVideoRef} className="absolute bottom-4 right-4 h-28 w-40 rounded-md border border-white/20 object-cover bg-black/40" muted playsInline autoPlay />
            {audioUnlockNeeded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Button onClick={unlockAudio} variant="secondary" className="gap-2">
                  <Mic className="h-4 w-4" />
                  Tap to start audio
                </Button>
              </div>
            )}
          </div>

          <div className="md:col-span-1 flex flex-col rounded-lg border border-border/40 bg-background/60">
            <div className="px-4 py-3 border-b border-border/40"><h2 className="font-semibold">Chat</h2></div>
            <div className="flex-1 p-3 space-y-2 overflow-y-auto min-h-[200px] max-h-[50vh] md:max-h-[calc(100%-6rem)]">
              {messages.length === 0 && <p className="text-sm text-muted-foreground">Say hello! Messages will appear here.</p>}
              {messages.map(m => (
                <div key={m.id} className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${m.senderId === userId ? 'ml-auto bg-primary text-primary-foreground' : 'mr-auto bg-muted'}`}>
                  <div>{m.text}</div>
                  <div className="mt-1 text-[10px] opacity-70 text-right">{new Date(m.ts).toLocaleTimeString()}</div>
                </div>
              ))}
            </div>
            <div className="p-3 border-t border-border/40">
              <div className="flex gap-2">
                <Input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Type a message" onKeyDown={e => { if (e.key === 'Enter') sendChat(); }} />
                <Button onClick={sendChat}>Send</Button>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </main>
  );
}

export default function CallWrapper() {
  return (
    <CallErrorBoundary>
      <Call />
    </CallErrorBoundary>
  );
}
