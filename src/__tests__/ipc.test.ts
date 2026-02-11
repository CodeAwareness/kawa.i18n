/**
 * Tests for IPC Protocol
 */

import { IPCMessage, sendResponse, sendError, sendBroadcast, sendProgress } from '../ipc/protocol';

describe('IPC Protocol', () => {
  let originalStdoutWrite: typeof process.stdout.write;
  let capturedOutput: string[];

  beforeEach(() => {
    // Capture stdout output
    capturedOutput = [];
    originalStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: any, encoding?: any, callback?: any) => {
      capturedOutput.push(chunk.toString());
      return true;
    }) as any;
  });

  afterEach(() => {
    // Restore stdout
    process.stdout.write = originalStdoutWrite;
  });

  describe('sendResponse', () => {
    it('should format success response correctly', () => {
      const request: IPCMessage = {
        flow: 'req',
        domain: 'i18n',
        action: 'translate-code',
        caw: 'client-1',
        data: {},
        _msgId: 'msg-123',
      };

      sendResponse(request, { code: 'translated code' });

      expect(capturedOutput.length).toBe(1);
      const output = capturedOutput[0];
      expect(output).toContain('MUNINN START:0');

      const jsonPart = output.split('MUNINN START:0 ')[1].trim();
      const response = JSON.parse(jsonPart);

      expect(response.flow).toBe('res');
      expect(response.domain).toBe('i18n');
      expect(response.action).toBe('translate-code');
      expect(response.caw).toBe('client-1');
      expect(response._msgId).toBe('msg-123');
      expect(response.data.code).toBe('translated code');
    });

    it('should preserve caw and _msgId from original', () => {
      const request: IPCMessage = {
        flow: 'req',
        domain: 'dictionary',
        action: 'add-terms',
        caw: 'client-42',
        data: {},
        _msgId: 'unique-id',
      };

      sendResponse(request, { success: true });

      const jsonPart = capturedOutput[0].split('MUNINN START:0 ')[1].trim();
      const response = JSON.parse(jsonPart);

      expect(response.caw).toBe('client-42');
      expect(response._msgId).toBe('unique-id');
    });
  });

  describe('sendError', () => {
    it('should format error response correctly', () => {
      const request: IPCMessage = {
        flow: 'req',
        domain: 'i18n',
        action: 'translate-code',
        caw: 'client-1',
        data: {},
        _msgId: 'msg-123',
      };

      sendError(request, 'Translation failed');

      const jsonPart = capturedOutput[0].split('MUNINN START:0 ')[1].trim();
      const response = JSON.parse(jsonPart);

      expect(response.flow).toBe('err');
      expect(response.domain).toBe('i18n');
      expect(response.action).toBe('translate-code');
      expect(response.caw).toBe('client-1');
      expect(response._msgId).toBe('msg-123');
      expect(response.data.error).toBe('Translation failed');
    });

    it('should handle Error objects', () => {
      const request: IPCMessage = {
        flow: 'req',
        domain: 'i18n',
        action: 'translate',
        caw: 'client-1',
        data: {},
      };

      sendError(request, new Error('Something went wrong'));

      const jsonPart = capturedOutput[0].split('MUNINN START:0 ')[1].trim();
      const response = JSON.parse(jsonPart);

      expect(response.data.error).toBe('Something went wrong');
    });
  });

  describe('sendBroadcast', () => {
    it('should send broadcast message correctly', () => {
      sendBroadcast('test', 'notify', { message: 'broadcast' });

      const jsonPart = capturedOutput[0].split('MUNINN START:0 ')[1].trim();
      const response = JSON.parse(jsonPart);

      expect(response.flow).toBe('brdc');
      expect(response.domain).toBe('test');
      expect(response.action).toBe('notify');
      expect(response.caw).toBe('0'); // Muninn caw
      expect(response.data.message).toBe('broadcast');
    });
  });

  describe('sendProgress', () => {
    it('should send progress message with correct structure', () => {
      sendProgress('task-1', 'Translating', 'started', {
        status: 'scanning',
        statusMessage: 'Starting translation',
        progress: 0,
      });

      const jsonPart = capturedOutput[0].split('MUNINN START:0 ')[1].trim();
      const response = JSON.parse(jsonPart);

      expect(response.flow).toBe('brdc');
      expect(response.domain).toBe('extension-progress');
      expect(response.action).toBe('started');
      expect(response.data.extensionId).toBe('i18n');
      expect(response.data.taskId).toBe('task-1');
      expect(response.data.title).toBe('Translating');
      expect(response.data.status).toBe('scanning');
      expect(response.data.progress).toBe(0);
    });

    it('should send progress update', () => {
      sendProgress('task-1', 'Translating', 'progress', {
        status: 'processing',
        progress: 50,
        currentStep: 5,
        totalSteps: 10,
      });

      const jsonPart = capturedOutput[0].split('MUNINN START:0 ')[1].trim();
      const response = JSON.parse(jsonPart);

      expect(response.action).toBe('progress');
      expect(response.data.status).toBe('processing');
      expect(response.data.progress).toBe(50);
      expect(response.data.currentStep).toBe(5);
      expect(response.data.totalSteps).toBe(10);
    });

    it('should send completion message', () => {
      sendProgress('task-1', 'Translating', 'complete', {
        status: 'complete',
        statusMessage: 'Translation complete',
        autoClose: true,
        autoCloseDelay: 3000,
      });

      const jsonPart = capturedOutput[0].split('MUNINN START:0 ')[1].trim();
      const response = JSON.parse(jsonPart);

      expect(response.action).toBe('complete');
      expect(response.data.status).toBe('complete');
      expect(response.data.autoClose).toBe(true);
      expect(response.data.autoCloseDelay).toBe(3000);
    });

    it('should send error message', () => {
      sendProgress('task-1', 'Translating', 'error', {
        status: 'error',
        error: 'Translation failed',
      });

      const jsonPart = capturedOutput[0].split('MUNINN START:0 ')[1].trim();
      const response = JSON.parse(jsonPart);

      expect(response.action).toBe('error');
      expect(response.data.status).toBe('error');
      expect(response.data.error).toBe('Translation failed');
    });
  });

  describe('IPCMessage interface', () => {
    it('should allow all valid flow types', () => {
      const messages: IPCMessage[] = [
        { flow: 'req', domain: 'test', action: 'a', caw: '1', data: {} },
        { flow: 'res', domain: 'test', action: 'a', caw: '1', data: {} },
        { flow: 'err', domain: 'test', action: 'a', caw: '1', data: {} },
        { flow: 'brdc', domain: 'test', action: 'a', caw: '1', data: {} },
      ];

      expect(messages.length).toBe(4);
      expect(messages[0].flow).toBe('req');
      expect(messages[1].flow).toBe('res');
      expect(messages[2].flow).toBe('err');
      expect(messages[3].flow).toBe('brdc');
    });
  });
});
