// REC: records the microphone and places the recording at the playhead.

import { makeClip } from '../doc/model';
import { addAudio } from '../doc/ops';
import { el, type Editor } from '../editor';
import { busy, errorText, toast } from '../ui/feedback';

export function installRecord(ed: Editor): { open(): void } {
  const dialog = el<HTMLDivElement>('record');
  const go = el<HTMLButtonElement>('record-go');
  const time = el<HTMLOutputElement>('record-time');
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let timer = 0;
  let started = 0;
  let keep = false;
  /** Changes whenever the dialog is opened, closed or restarted, so late answers can tell they are stale. */
  let session = 0;
  let starting = false;

  function reset(): void {
    window.clearInterval(timer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    recorder = null;
    dialog.classList.remove('recording');
    go.textContent = 'Start';
    time.value = '00:00';
  }

  async function start(): Promise<void> {
    if (starting || recorder) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast('This browser cannot record sound');
      return;
    }
    const mine = ++session;
    starting = true;
    let opened: MediaStream;
    try {
      opened = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      starting = false;
      toast('The microphone is not available. Check the permission for this site.');
      return;
    }
    starting = false;
    if (mine !== session) {
      // Cancelled while the permission question was open.
      opened.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = opened;
    const mineChunks: Blob[] = [];
    keep = false;
    recorder = new MediaRecorder(stream);
    const used = recorder;
    recorder.addEventListener('dataavailable', (e) => {
      if (e.data.size) mineChunks.push(e.data);
    });
    recorder.addEventListener('stop', () => {
      opened.getTracks().forEach((t) => t.stop());
      // A recorder from an earlier opening of the dialog has nothing to say any more.
      if (mine !== session) return;
      const type = used.mimeType || mineChunks[0]?.type || 'audio/webm';
      const blob = new Blob(mineChunks, { type: type.split(';')[0] });
      const wanted = keep;
      reset();
      dialog.hidden = true;
      if (wanted && blob.size) void place(blob);
    });
    recorder.start(1000);
    started = performance.now();
    dialog.classList.add('recording');
    go.textContent = 'Stop';
    timer = window.setInterval(() => {
      const s = Math.floor((performance.now() - started) / 1000);
      time.value = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }, 250);
  }

  async function place(blob: Blob): Promise<void> {
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '-');
    try {
      const info = await busy('Adding recording', (progress) => ed.media.import(blob, `Voice ${stamp}.${ext}`, progress, true));
      const clip = makeClip('audio', Math.max(0.1, Math.floor(info.duration * ed.project.fps) / ed.project.fps), { mediaId: info.id });
      ed.edit((p) => {
        p.media.push(info);
        addAudio(p, clip, ed.time);
      });
      ed.select(clip.id);
    } catch (err) {
      toast(errorText(err, 'The recording could not be added'));
    }
  }

  go.addEventListener('click', () => {
    if (recorder && recorder.state !== 'inactive') {
      keep = true;
      recorder.stop();
    } else {
      void start();
    }
  });
  el('record-cancel').addEventListener('click', () => {
    keep = false;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    else {
      session++;
      reset();
      dialog.hidden = true;
    }
  });

  return {
    open() {
      ed.player.pause();
      session++;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      reset();
      dialog.hidden = false;
    },
  };
}
