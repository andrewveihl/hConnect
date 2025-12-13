<script lang="ts">
  import { sendMessage } from '$lib/firestore';
  import { currentServerId, currentChannelId, messages } from '$lib/stores/index';

  let input = $state('');
  let loading = $state(false);
  let textareaElement: HTMLTextAreaElement;

  function autoResizeTextarea() {
    if (textareaElement) {
      textareaElement.style.height = 'auto';
      textareaElement.style.height = Math.min(textareaElement.scrollHeight, 120) + 'px';
    }
  }

  async function handleSendMessage() {
    const content = input.trim();
    if (!content || !$currentServerId || !$currentChannelId || loading) return;

    loading = true;
    try {
      const msg = await sendMessage($currentServerId, $currentChannelId, content);
      messages.update((msgs) => [...msgs, msg]);
      input = '';
      if (textareaElement) {
        textareaElement.style.height = '40px';
      }
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      loading = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }
</script>

<!-- Chat Input -->
<div class="h-auto bg-gray-800 border-t border-gray-700 px-4 py-3">
  <div class="flex items-end gap-3">
    <!-- Input -->
    <div class="flex-1 flex gap-2 items-end">
      <button
        class="p-2 hover:bg-gray-700 rounded-lg transition-colors text-gray-400 hover:text-white flex-shrink-0"
        title="Attach file"
      >
        <i class="bx bx-plus-circle text-xl"></i>
      </button>

      <div class="flex-1">
        <textarea
          bind:this={textareaElement}
          bind:value={input}
          oninput={autoResizeTextarea}
          onkeydown={handleKeydown}
          placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
          rows="1"
          class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
          style="min-height: 40px; max-height: 120px;"
          disabled={!$currentChannelId || loading}
        ></textarea>
      </div>
    </div>

    <!-- Send Button -->
    <button
      onclick={handleSendMessage}
      disabled={!input.trim() || !$currentChannelId || loading}
      class="p-2 rounded-lg transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
      class:bg-teal-600={input.trim() && $currentChannelId && !loading}
      class:hover:bg-teal-700={input.trim() && $currentChannelId && !loading}
      class:bg-gray-700={!input.trim() || !$currentChannelId || loading}
      title="Send message"
    >
      <i class="bx bx-send text-xl text-white"></i>
    </button>
  </div>
</div>
