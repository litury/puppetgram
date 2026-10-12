import { Api, TelegramClient } from "telegram";
import { IResolvedDiscussion } from "../interfaces";

export async function resolveDiscussion(
  client: TelegramClient,
  channelUsername: string,
  postId: number,
  expectedDiscussionChannelId?: string,
): Promise<IResolvedDiscussion> {
  let stage = "getInputEntity";
  try {
    const peer = await client.getInputEntity(channelUsername);
    stage = "messages.GetDiscussionMessage";
    const result = await client.invoke(new Api.messages.GetDiscussionMessage({ peer, msgId: postId }));
    const root = result.messages[result.messages.length - 1];
    if (!(root instanceof Api.Message) || !(root.peerId instanceof Api.PeerChannel) ||
        !(peer instanceof Api.InputPeerChannel) || root.peerId.channelId.equals(peer.channelId)) {
      throw new Error("DISCUSSION_UNAVAILABLE: Не найден корень обсуждения");
    }
    if ((expectedDiscussionChannelId && root.peerId.channelId.toString() !== expectedDiscussionChannelId) ||
        (root.fromId instanceof Api.PeerChannel && !root.fromId.channelId.equals(peer.channelId))) {
      throw new Error(`DISCUSSION_MISMATCH: Несоответствие группы или отправителя корня; sourceChannelId=${peer.channelId}; discussionChannelId=${root.peerId.channelId}; expectedDiscussionChannelId=${expectedDiscussionChannelId ?? "unknown"}; rootMessageId=${root.id}`);
    }
    stage = "getInputEntity(discussion)";
    return {
      channelUsername,
      postId,
      peer: await client.getInputEntity(root.peerId),
      rootMessageId: root.id,
    };
  } catch (error: any) {
    throw Object.assign(new Error(`${error.message || error}; stage=${stage}; channel=${channelUsername}; postId=${postId}`), {
      code: error.code,
      seconds: error.seconds,
      errorMessage: error.errorMessage,
    });
  }
}
