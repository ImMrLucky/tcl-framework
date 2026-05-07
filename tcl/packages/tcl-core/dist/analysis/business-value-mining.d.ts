import type { BusinessInsight, Claim } from "../types.js";
export declare function mineBusinessInsights(claims: Claim[]): {
    insights: BusinessInsight[];
    businessValueScore: number;
};
