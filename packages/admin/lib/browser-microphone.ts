import { encodePcm16 } from '@/lib/dashscope-realtime-client';

export type MicrophoneCapture = {
	/** 停止采集并释放麦克风；重复调用无副作用。 */
	stop: () => void;
};

/**
 * 采集浏览器麦克风，重采样为 16 kHz / 16-bit / 单声道 PCM，按设备回调节奏交给 `onFrame`。
 * 回声消除、降噪和自动增益全部关闭，保证调试时送出的就是原始人声。
 */
export async function startMicrophonePcm16(onFrame: (pcm: Uint8Array) => void): Promise<MicrophoneCapture> {
	if (!navigator.mediaDevices?.getUserMedia) {
		throw new Error('当前浏览器不支持麦克风采集');
	}
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: {
			channelCount: 1,
			echoCancellation: false,
			noiseSuppression: false,
			autoGainControl: false,
		},
	});
	let context: AudioContext | null = null;
	let source: MediaStreamAudioSourceNode | null = null;
	let processor: ScriptProcessorNode | null = null;
	let stopped = false;

	const stop = () => {
		if (stopped) return;
		stopped = true;
		if (processor) processor.onaudioprocess = null;
		processor?.disconnect();
		source?.disconnect();
		for (const track of stream.getTracks()) track.stop();
		if (context && context.state !== 'closed') void context.close();
	};

	try {
		context = new AudioContext();
		await context.resume();
		source = context.createMediaStreamSource(stream);
		processor = context.createScriptProcessor(4096, 1, 1);
		const sampleRate = context.sampleRate;
		processor.onaudioprocess = (event) => {
			if (stopped) return;
			onFrame(encodePcm16(event.inputBuffer.getChannelData(0), sampleRate));
			// ScriptProcessor 需要连到输出节点才会持续触发；输出清零，避免麦克风回放。
			event.outputBuffer.getChannelData(0).fill(0);
		};
		source.connect(processor);
		processor.connect(context.destination);
	} catch (error) {
		stop();
		throw error;
	}
	return { stop };
}
