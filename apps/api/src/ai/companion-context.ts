/** Cross-surface history is reference data, never executable instructions. */
export function companionContext(messages: {role: string; content: string}[]) {
  return messages.slice(-16).filter(m => ['user','assistant'].includes(m.role))
    .map(m => ({role:m.role, content:m.content.slice(-2000)}));
}

export const recommendationSchema = {
  type:'object', additionalProperties:false, required:['reflection','suggestions'], properties:{
    reflection:{type:'string'}, suggestions:{type:'array',maxItems:3,items:{
      type:'object',additionalProperties:false,required:['name','duration','reason'],properties:{
        name:{type:'string'},duration:{type:'integer',minimum:10,maximum:120},reason:{type:'string'},
      },
    }},
  },
};
export function parseRecommendation(value: string) {
  const data = JSON.parse(value);
  if (typeof data.reflection !== 'string' || data.reflection.length > 1500 || !Array.isArray(data.suggestions) || data.suggestions.length > 3)
    throw new Error('Invalid recommendation');
  const suggestions: {name:string;duration:number;reason:string}[] = data.suggestions.map((s: any) => {
    if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 100 ||
      !Number.isInteger(s.duration) || s.duration < 10 || s.duration > 120 ||
      typeof s.reason !== 'string' || s.reason.length > 600) throw new Error('Invalid suggestion');
    return {name:s.name.trim(), duration:s.duration, reason:s.reason};
  });
  return {reflection:data.reflection as string,suggestions};
}
