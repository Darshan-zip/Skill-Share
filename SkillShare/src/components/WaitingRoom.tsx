import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';

interface WaitingRoomProps {
  userId: string;
  possessSkills: string[];
  wantSkills: string[];
}

export const WaitingRoom = ({ userId, possessSkills, wantSkills }: WaitingRoomProps) => {
  const [waitingTime, setWaitingTime] = useState(0);
  const [searchingText, setSearchingText] = useState('Searching for a match');
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const timer = setInterval(() => {
      setWaitingTime(prev => prev + 1);
    }, 1000);

    const textCycle = setInterval(() => {
      setSearchingText(prev => {
        if (prev === 'Searching for a match') return 'Searching for a match.';
        if (prev === 'Searching for a match.') return 'Searching for a match..';
        if (prev === 'Searching for a match..') return 'Searching for a match...';
        return 'Searching for a match';
      });
    }, 500);

    return () => {
      clearInterval(timer);
      clearInterval(textCycle);
    };
  }, []);

  // Resiliency: poll for match/session in case a realtime event is missed
  useEffect(() => {
    let isCancelled = false;
    const poll = async () => {
      try {
        // Check waiting_room status for this user
        const { data: wr } = await supabase
          .from('waiting_room')
          .select('status, matched_with')
          .eq('user_id', userId)
          .single();

        if (!isCancelled && wr && wr.status === 'matched' && wr.matched_with) {
          toast({ title: 'Match Found!', description: 'Connecting you to your match...' });
          navigate(`/call/${wr.matched_with}`);
          return; // stop after navigation
        }

        // Check active call session involving this user
        const { data: sessions } = await supabase
          .from('call_sessions')
          .select('user1_id, user2_id, status')
          .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
          .eq('status', 'active')
          .limit(1);

        if (!isCancelled && sessions && sessions.length > 0) {
          const session = sessions[0] as any;
          const otherId = session.user1_id === userId ? session.user2_id : session.user1_id;
          toast({ title: 'Match Found!', description: 'Connecting you to your match...' });
          navigate(`/call/${otherId}`);
        }
      } catch (_) {}
    };

    // Initial immediate check, then interval
    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [userId, navigate, toast]);

  useEffect(() => {
    // Listen for matches
    const channel = supabase
      .channel('waiting_room_changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'waiting_room',
          filter: `user_id=eq.${userId}`
        },
        (payload) => {
          if (payload.new.status === 'matched' && payload.new.matched_with) {
            toast({
              title: "Match Found!",
              description: "Connecting you to your match...",
            });
            navigate(`/call/${payload.new.matched_with}`);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, navigate, toast]);

  // Fallback: listen for call session creation involving this user
  useEffect(() => {
    const channel = supabase
      .channel(`call_sessions_for_${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'call_sessions' },
        (payload) => {
          const { user1_id, user2_id, status } = payload.new as any;
          if (status === 'active' && (user1_id === userId || user2_id === userId)) {
            const otherId = user1_id === userId ? user2_id : user1_id;
            toast({ title: 'Match Found!', description: 'Connecting you to your match...' });
            navigate(`/call/${otherId}`);
          }
        }
      )
      // Also listen for status updates to active, in case insert was missed
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'call_sessions' },
        (payload) => {
          const { user1_id, user2_id, status } = payload.new as any;
          if (status === 'active' && (user1_id === userId || user2_id === userId)) {
            const otherId = user1_id === userId ? user2_id : user1_id;
            toast({ title: 'Match Found!', description: 'Connecting you to your match...' });
            navigate(`/call/${otherId}`);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, navigate, toast]);

  // Also listen for updates where another user's row gets matched with this user
  useEffect(() => {
    const channel = supabase
      .channel('waiting_room_matched_with_changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'waiting_room' },
        (payload) => {
          const { status, matched_with, user_id } = payload.new as any;
          if (status === 'matched' && matched_with === userId) {
            toast({ title: 'Match Found!', description: 'Connecting you to your match...' });
            navigate(`/call/${user_id}`);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, navigate, toast]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-card to-background">
      <Card className="max-w-2xl w-full p-8 space-y-8 backdrop-blur-sm bg-card/80 border-primary/20">
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <Loader2 className="h-16 w-16 animate-spin text-primary" />
          </div>
          
          <h2 className="text-3xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            {searchingText}
          </h2>
          
          <p className="text-lg text-muted-foreground">
            Waiting time: <span className="text-foreground font-mono">{formatTime(waitingTime)}</span>
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-primary uppercase tracking-wide">
              Skills You Possess
            </h3>
            <div className="space-y-2">
              {possessSkills.map((skill) => (
                <div
                  key={skill}
                  className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-sm"
                >
                  {skill}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-secondary uppercase tracking-wide">
              Skills You Want
            </h3>
            <div className="space-y-2">
              {wantSkills.map((skill) => (
                <div
                  key={skill}
                  className="p-3 rounded-lg bg-secondary/10 border border-secondary/20 text-sm"
                >
                  {skill}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            We're finding someone who wants to learn what you know, and can teach what you want to learn.
          </p>
        </div>
      </Card>
    </div>
  );
};
