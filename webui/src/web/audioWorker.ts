import { createAudioTasks, type AudioReply, type AudioRequest } from './audioTasks';

// Worker entry: cutting, Opus encoding and base64 stay off the main thread.
const scope = self as unknown as { onmessage: ((event: MessageEvent<AudioRequest>) => void) | null; postMessage: (reply: AudioReply) => void };
const tasks = createAudioTasks();

scope.onmessage = event => {
  void tasks.handle(event.data).then(reply => scope.postMessage(reply));
};
