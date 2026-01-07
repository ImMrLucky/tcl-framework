/**
 * Topic Segmentation
 *
 * Segments claims into topic clusters to enforce:
 * - CONTRADICTION edges only within the same topic
 * - SUPPORT edges across topics only with strict slot match
 *
 * This prevents nonsense edges across unrelated topics.
 */
import { ClaimNode, TopicNode } from './types.js';
export interface TopicCluster {
    id: string;
    label: string;
    slotTypes: string[];
    entityKeys: string[];
    claimIds: string[];
    turnRange: {
        start: number;
        end: number;
    };
}
export interface SegmentationResult {
    clusters: TopicCluster[];
    claimTopicMap: Map<string, string>;
    topicNodes: TopicNode[];
}
export declare function assignTopicIds(claims: ClaimNode[]): SegmentationResult;
export declare function topicsMatch(topicA: string | undefined, topicB: string | undefined): boolean;
export declare function canCreateContradictionEdge(claimA: ClaimNode, claimB: ClaimNode, requireSameTopic: boolean): boolean;
export declare function canCreateSupportEdge(claimA: ClaimNode, claimB: ClaimNode, allowCrossTopicOnlyOnStrictSlotMatch: boolean): boolean;
