import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SkillInput } from '@/components/SkillInput';
import { WaitingRoom } from '@/components/WaitingRoom';
import { useToast } from '@/hooks/use-toast';
import { Video, LogOut } from 'lucide-react';
import type { User } from '@supabase/supabase-js';

export default function Index() {
  const [user, setUser] = useState<User | null>(null);
  const [possessSkills, setPossessSkills] = useState<string[]>([]);
  const [wantSkills, setWantSkills] = useState<string[]>([]);
  const [isInWaitingRoom, setIsInWaitingRoom] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (!session) {
        navigate('/auth');
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session) {
        navigate('/auth');
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };

  const handleContinue = async () => {
    if (possessSkills.length === 0 || wantSkills.length === 0) {
      toast({
        title: "Missing skills",
        description: "Please add at least one skill you possess and one you want to learn.",
        variant: "destructive",
      });
      return;
    }

    if (!user) return;

    try {
      // Delete any existing waiting room entry first
      await supabase
        .from('waiting_room')
        .delete()
        .eq('user_id', user.id);

      // Insert user into waiting room
      const { error } = await supabase
        .from('waiting_room')
        .insert({
          user_id: user.id,
          possess_skills: possessSkills,
          want_skills: wantSkills,
          status: 'waiting'
        });

      if (error) throw error;

      setIsInWaitingRoom(true);
      toast({
        title: "Entered waiting room",
        description: "Searching for your perfect match...",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  if (isInWaitingRoom && user) {
    return (
      <WaitingRoom
        userId={user.id}
        possessSkills={possessSkills}
        wantSkills={wantSkills}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-card to-background">
      <header className="border-b border-border/40 backdrop-blur-sm bg-card/50">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-primary to-secondary">
              <Video className="h-6 w-6 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
              Skill Share
            </h1>
          </div>
          <Button onClick={handleSignOut} variant="ghost" size="sm">
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto space-y-8">
          <div className="text-center space-y-4">
            <h2 className="text-4xl md:text-5xl font-bold">
              Connect, Learn, <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">Grow</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Share your expertise and learn new skills through 1-on-1 video calls. Get matched with someone who can teach what you want to learn, while you teach them something new.
            </p>
          </div>

          <Card className="p-8 space-y-6 backdrop-blur-sm bg-card/80 border-primary/20 shadow-lg">
            <SkillInput
              label="Skills You Possess"
              placeholder="e.g., Guitar, Python, Spanish"
              skills={possessSkills}
              onSkillsChange={setPossessSkills}
              variant="possess"
            />

            <SkillInput
              label="Skills You Want to Learn"
              placeholder="e.g., Photography, React, Cooking"
              skills={wantSkills}
              onSkillsChange={setWantSkills}
              variant="want"
            />

            <Button
              onClick={handleContinue}
              className="w-full h-12 text-lg font-semibold"
              disabled={possessSkills.length === 0 || wantSkills.length === 0}
            >
              Continue to Connection
            </Button>
          </Card>

          <div className="grid md:grid-cols-3 gap-6 text-center">
            <div className="space-y-2">
              <div className="text-3xl font-bold text-primary">1</div>
              <div className="text-sm text-muted-foreground">Add Your Skills</div>
            </div>
            <div className="space-y-2">
              <div className="text-3xl font-bold text-primary">2</div>
              <div className="text-sm text-muted-foreground">Get Matched</div>
            </div>
            <div className="space-y-2">
              <div className="text-3xl font-bold text-primary">3</div>
              <div className="text-sm text-muted-foreground">Start Learning</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
