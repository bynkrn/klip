using System;
using System.Media;
using System.Windows.Forms;

// Tiny non-activating playback process for the opt-in native exclusion test.
class AudioExclusionTarget : Form {
    readonly SoundPlayer player;
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams { get { var p = base.CreateParams; p.ExStyle |= 0x08000000; return p; } }
    AudioExclusionTarget(string file) {
        Text = "Ember audio exclusion verification";
        Width = 240; Height = 80; ShowInTaskbar = false;
        player = new SoundPlayer(file); player.Load();
        Shown += delegate { player.PlayLooping(); };
        FormClosed += delegate { player.Stop(); player.Dispose(); };
    }
    [STAThread] static void Main(string[] args) { Application.Run(new AudioExclusionTarget(args[0])); }
}
