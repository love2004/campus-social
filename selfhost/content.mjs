// Shared by the worker and browser: Chinese character counts include punctuation,
// but exclude whitespace, source URLs and standalone hashtags.
export function captionLength(text='') {
  return Array.from(text.replace(/https?:\/\/\S+/giu,'').replace(/(^|\s)#[\p{L}\p{N}_]+/gu,'$1').replace(/\s/gu,'')).length;
}
export function captionRange(settings={}) {
  return {min:settings.captionMinChars??200,max:settings.captionMaxChars??300};
}
export function captionIssues(variants,settings={}) {
  const {min,max}=captionRange(settings);
  return Object.entries(variants).flatMap(([platform,text])=>{
    const count=captionLength(text);return count<min||count>max?[{platform,count,min,max}]:[];
  });
}
