import posthog from 'posthog-js';
const K=import.meta.env.VITE_POSTHOG_API_KEY||'',H=import.meta.env.VITE_POSTHOG_HOST||'https://us.i.posthog.com';
export function init(){K?posthog.init(K,{api_host:H,capture_pageview:false,capture_pageleave:true,autocapture:true,loaded:(p)=>{import.meta.env.DEV&&p.opt_out_capturing()}}):import.meta.env.DEV&&console.warn('[PostHog] VITE_POSTHOG_API_KEY not set')}
export function pageview(p){posthog.capture('$pageview',{$current_url:p||location.href})}
export function identify(o){posthog.identify(o.distinctId,{email:o.email,name:o.name,role:o.role,club_slug:o.clubSlug});o.clubSlug&&posthog.group('club',o.clubSlug,{slug:o.clubSlug})}
export function reset(){posthog.reset()}
export{useFeatureFlagEnabled,useFeatureFlagVariantKey}from'posthog-js/react';
