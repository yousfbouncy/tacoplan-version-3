import {useEffect,useRef,useState} from "react";
import {Modal,View,Text,Pressable,StyleSheet,ActivityIndicator,AppState} from "react-native";
import {Ionicons} from "@expo/vector-icons";
import {useAuth} from "@/lib/auth-context";
import {useI18n} from "@/lib/i18n-context";
import {emailConsentCopy} from "@/lib/email-consent-copy";
import {readEmailChoice,recordInitialEmailChoice} from "@/lib/email-consent";

export function EmailConsentPanel({choice,onChoice,disabled=false}:{choice:boolean|null;onChoice:(v:boolean)=>void;disabled?:boolean}){
 const {locale}=useI18n();const c=emailConsentCopy[locale];
 return <View style={s.panel}>
 <View style={s.icon}><Ionicons name="mail-outline" size={28} color="#1765E8"/></View>
 <Text style={s.title}>{c.title}</Text><Text style={s.body}>{c.body}</Text><Text style={s.note}>{c.note}</Text>
 {[true,false].map(v=><Pressable key={String(v)} accessibilityRole="button" accessibilityState={{selected:choice===v,disabled}} disabled={disabled} onPress={()=>onChoice(v)} style={[s.button,choice===v&&s.selected,disabled&&{opacity:.6}]}>
 <Text style={[s.buttonText,choice===v&&s.selectedText]}>{v?c.yes:c.no}</Text></Pressable>)}
 </View>;
}
export default function EmailConsentPrompt({enabled,onSettled}:{enabled:boolean;onSettled:(v:boolean)=>void}){
 const {user}=useAuth();const {locale}=useI18n();
 const [visible,setVisible]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(false);
 const busy=useRef(false),done=useRef(false);const userId=user?.id;
 useEffect(()=>{
  let alive=true;done.current=false;setVisible(false);onSettled(false);
  if(!enabled||!userId)return;
  const check=async()=>{if(done.current||busy.current)return;try{const choice=await readEmailChoice(userId);if(!alive||done.current||busy.current)return;if(choice===null){setVisible(true);}else{done.current=true;setVisible(false);onSettled(true);}}catch{if(alive){setVisible(false);onSettled(true);}}};
  void check();const listener=AppState.addEventListener("change",state=>{if(state==="active")void check();});
  return()=>{alive=false;listener.remove();};
 },[enabled,userId,onSettled]);
 const choose=async(v:boolean)=>{
  if(!userId||busy.current)return;busy.current=true;setSaving(true);setError(false);
  try{await recordInitialEmailChoice(userId,v);done.current=true;setVisible(false);onSettled(true);}catch{setError(true);/* fail open, never infer consent */if(!v){setVisible(false);onSettled(true);}}
  finally{busy.current=false;setSaving(false);}
 };
 return <Modal visible={enabled&&visible} transparent animationType="fade" onRequestClose={()=>{void choose(false);}}><View style={s.backdrop}><View style={s.modal}><EmailConsentPanel choice={null} disabled={saving} onChoice={v=>{void choose(v);}}/>{saving&&<ActivityIndicator color="#1765E8"/>}{error&&<Text style={s.note}>{emailConsentCopy[locale].error}</Text>}</View></View></Modal>;
}
const s=StyleSheet.create({backdrop:{flex:1,backgroundColor:"rgba(9,22,40,.66)",justifyContent:"center",padding:20},modal:{backgroundColor:"#fff",borderRadius:22,padding:22,maxWidth:440,width:"100%",alignSelf:"center"},panel:{gap:13,padding:8},icon:{alignSelf:"center",width:58,height:58,borderRadius:29,backgroundColor:"#E5F0FF",alignItems:"center",justifyContent:"center"},title:{fontSize:23,fontWeight:"800",color:"#102B4E",textAlign:"center"},body:{fontSize:16,lineHeight:23,color:"#334155",textAlign:"center"},note:{fontSize:13,lineHeight:19,color:"#64748B",textAlign:"center"},button:{borderWidth:1,borderColor:"#1765E8",borderRadius:12,padding:14,alignItems:"center",backgroundColor:"#fff"},buttonText:{fontSize:16,fontWeight:"700",color:"#1765E8"},selected:{backgroundColor:"#1765E8"},selectedText:{color:"#fff"}});
