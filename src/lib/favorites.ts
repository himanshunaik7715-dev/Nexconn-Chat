export type FavoriteChannelType = 'direct' | 'group';
export interface FavoriteChannel { channelType: FavoriteChannelType; channelId: string }

const favoriteChannels = new Set<string>();

export function favoriteChannelKey(channelType: FavoriteChannelType, channelId: string) {
  return `${channelType}:${channelId}`;
}

export function isFavoriteChannel(channelType: FavoriteChannelType, channelId: string) {
  return favoriteChannels.has(favoriteChannelKey(channelType, channelId));
}

export function replaceFavoriteChannels(channels: FavoriteChannel[]) {
  favoriteChannels.clear();
  for (const channel of channels) favoriteChannels.add(favoriteChannelKey(channel.channelType, channel.channelId));
}

export function updateFavoriteChannel(channelType: FavoriteChannelType, channelId: string, favorite: boolean) {
  const key = favoriteChannelKey(channelType, channelId);
  if (favorite) favoriteChannels.add(key);
  else favoriteChannels.delete(key);
}
