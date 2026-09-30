/** Social networks whose profile link + follower stats a competitor profile can hold. */
export const SOCIAL_KEYS = ["facebook", "instagram", "tiktok", "linkedin", "youtube", "x"] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];
