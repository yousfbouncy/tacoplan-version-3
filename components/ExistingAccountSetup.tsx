import React,{useCallback,useEffect,useState} from "react";
import {ActivityIndicator,Pressable,ScrollView,Text,TextInput,View} from "react-native";
import {supabase} from "@/lib/supabase";
import {useAuth} from "@/lib/auth-context";

const bg="#102844",card="#153655",muted="#B9CFE6",blue="#1765E8";
const validEmail=(email:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

/**
 * Completes missing account details on existing profiles without touching
 * jornadas, onboarding flags, company membership or subscription state.
 * Passwords are sent only to Supabase Auth, never to app storage/profiles.
 */
export default function ExistingAccountSetup({children}:{children:React.ReactNode}){
  const {user}=useAuth();
  const [checking,setChecking]=useState(true);
  const [required,setRequired]=useState(false);
  const [fullName,setFullName]=useState("");
  const [email,setEmail]=useState("");
  const [confirmedEmail,setConfirmedEmail]=useState("");
  const [provider,setProvider]=useState<"apple"|"google"|"email"|"other">("other");
  const [needsPassword,setNeedsPassword]=useState(false);
  const [password,setPassword]=useState("");
  const [passwordAgain,setPasswordAgain]=useState("");
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");

  const check=useCallback(async()=>{
    if(!user?.id){setChecking(false);return;}
    setChecking(true);setError("");
    try{
      const [{data:auth,error:authError},{data:profile,error:profileError}]=await Promise.all([
        supabase.auth.getUser(),
        supabase.from("profiles").select("name,display_name").eq("id",user.id).maybeSingle(),
      ]);
      if(authError||!auth.user||profileError)throw new Error("No se ha podido comprobar la cuenta");
      const identity=auth.user;
      const identities=identity.identities||[];
      const providers:Array<string>=Array.isArray(identity.app_metadata?.providers)?identity.app_metadata.providers:[];
      const has=(p:string)=>providers.includes(p)||identities.some(i=>i.provider===p)||identity.app_metadata?.provider===p;
      const type=has("apple")?"apple":has("google")?"google":has("email")?"email":"other";
      const savedName=String(profile?.display_name||profile?.name||"").trim();
      const suggested=String(identity.user_metadata?.full_name||identity.user_metadata?.name||user.name||"").trim();
      const existingEmail=identity.email||user.email||"";
      // OAuth users who enabled password login in Tacoplan receive the
      // metadata flag on successful updateUser({password}).
      const hasPassword=has("email")||identity.user_metadata?.tacoplan_password_enabled===true;
      const passwordMissing=(type==="apple"||type==="google")&&!hasPassword;
      setProvider(type);
      setFullName(savedName||suggested);
      setConfirmedEmail(existingEmail);
      setEmail(type==="apple"&&(!existingEmail||existingEmail.endsWith("@privaterelay.appleid.com"))?"":existingEmail);
      setNeedsPassword(passwordMissing);
      setRequired(!savedName||passwordMissing||(type==="apple"&&(!existingEmail||existingEmail.endsWith("@privaterelay.appleid.com"))));
      setNotice("");
    }catch{
      // Do not lock drivers out of a working offline app if checking the
      // server is temporarily impossible. Retry on the next launch.
      setRequired(false);
    }finally{setChecking(false);}
  },[user?.id,user?.email,user?.name]);
  useEffect(()=>{void check()},[check]);

  const save=async()=>{
    if(saving)return;
    setError("");setNotice("");
    const name=fullName.trim(),address=email.trim().toLowerCase();
    if(!name){setError("Escribe tu nombre y apellidos.");return;}
    if(!validEmail(address)){setError("Escribe una dirección de correo válida.");return;}
    if(needsPassword&&(password.length<8||password!==passwordAgain)){
      setError("La contraseña debe tener al menos 8 caracteres y coincidir en ambos campos.");return;
    }
    setSaving(true);
    try{
      // Apple may return a private-relay address. Changing the Auth email
      // requires confirmation before password sign-in at the new address.
      if(provider==="apple"&&address!==confirmedEmail.toLowerCase()){
        const {error:e}=await supabase.auth.updateUser({email:address});
        if(e)throw e;
        setNotice("Comprueba tu correo y confirma la dirección nueva. Después vuelve a Tacoplan para terminar la configuración.");
        return;
      }
      // Persist name before optional credentials, preserving existing data.
      const {error:nameError}=await supabase.from("profiles").update({
        display_name:name,name,updated_at:new Date().toISOString(),
      } as any).eq("id",user!.id);
      if(nameError)throw nameError;
      if(needsPassword){
        const {error:passError}=await supabase.auth.updateUser({
          password,
          data:{tacoplan_password_enabled:true},
        });
        if(passError)throw passError;
      }
      setPassword("");setPasswordAgain("");setRequired(false);
    }catch(e:any){
      setError(e?.message||"No se pudo guardar. Inténtalo de nuevo.");
    }finally{setSaving(false);}
  };

  if(checking)return <View style={{flex:1,justifyContent:"center",alignItems:"center",backgroundColor:bg}}><ActivityIndicator color="white"/><Text style={{color:muted,marginTop:12}}>Comprobando los datos de tu cuenta…</Text></View>;
  if(!required)return <>{children}</>;
  return <ScrollView style={{flex:1,backgroundColor:bg}} contentContainerStyle={{padding:20,paddingTop:48,paddingBottom:56}}>
    <Text style={{color:"#FFFFFF",fontWeight:"800",fontSize:25}}>Protege tu cuenta de Tacoplan</Text>
    <Text style={{color:muted,fontSize:14,lineHeight:22,marginTop:10,marginBottom:20}}>
      Completa estos datos una sola vez. El nombre permite identificar correctamente tu perfil.
      El correo y la contraseña te permiten recuperar el acceso y entrar desde otro teléfono,
      incluso si cambias de iPhone a Android. No se borrarán tus jornadas ni tus dietas.
    </Text>
    <View style={{backgroundColor:card,borderRadius:18,padding:18,gap:12}}>
      <Text style={{color:"#FFFFFF",fontWeight:"700"}}>Nombre y apellidos *</Text>
      <TextInput accessibilityLabel="Nombre y apellidos" value={fullName} onChangeText={setFullName} autoCapitalize="words" placeholder="Tu nombre y apellidos" placeholderTextColor="#9DB5CF" style={{backgroundColor:"#FFFFFF",borderRadius:10,padding:13,color:"#172B46",fontSize:16}}/>
      <Text style={{color:"#FFFFFF",fontWeight:"700"}}>Correo electrónico *</Text>
      <TextInput accessibilityLabel="Correo electrónico" value={email} onChangeText={setEmail} editable={provider==="apple"} autoCapitalize="none" keyboardType="email-address" placeholder="tu@email.com" placeholderTextColor="#9DB5CF" style={{backgroundColor:provider==="apple"?"#FFFFFF":"#DEE8F2",borderRadius:10,padding:13,color:"#172B46",fontSize:16}}/>
      <Text style={{color:muted,fontSize:12,lineHeight:18}}>{provider==="apple"?"Si Apple ocultó tu correo, introduce uno personal. Te enviaremos una confirmación.": "Este correo pertenece a la cuenta con la que ya has iniciado sesión."}</Text>
      {needsPassword?<><Text style={{color:"#FFFFFF",fontWeight:"700"}}>Crear contraseña *</Text>
        <TextInput accessibilityLabel="Crear contraseña" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" textContentType="newPassword" placeholder="Mínimo 8 caracteres" placeholderTextColor="#9DB5CF" style={{backgroundColor:"#FFFFFF",borderRadius:10,padding:13,color:"#172B46",fontSize:16}}/>
        <Text style={{color:"#FFFFFF",fontWeight:"700"}}>Confirmar contraseña *</Text>
        <TextInput accessibilityLabel="Confirmar contraseña" value={passwordAgain} onChangeText={setPasswordAgain} secureTextEntry autoCapitalize="none" textContentType="newPassword" placeholder="Repite la contraseña" placeholderTextColor="#9DB5CF" style={{backgroundColor:"#FFFFFF",borderRadius:10,padding:13,color:"#172B46",fontSize:16}}/>
        <Text style={{color:muted,fontSize:12}}>Seguirás pudiendo entrar con Google o Apple. Tu contraseña se gestiona en el sistema seguro de autenticación, no en las jornadas.</Text>
      </>:null}
      {error?<Text accessibilityRole="alert" style={{color:"#FFC5C5",fontSize:13}}>{error}</Text>:null}
      {notice?<Text accessibilityRole="alert" style={{color:"#B4F3D1",fontSize:13}}>{notice}</Text>:null}
      <Pressable disabled={saving} onPress={()=>void save()} style={{backgroundColor:blue,borderRadius:12,padding:16,alignItems:"center",opacity:saving ? 0.65 : 1}}>
        <Text style={{color:"#FFFFFF",fontWeight:"800",fontSize:16}}>{saving?"Guardando…":"Guardar y continuar"}</Text>
      </Pressable>
      {notice?<Pressable onPress={()=>void check()} style={{padding:10,alignItems:"center"}}><Text style={{color:"#FFFFFF",textDecorationLine:"underline"}}>Ya he verificado mi correo: comprobar de nuevo</Text></Pressable>:null}
    </View>
  </ScrollView>;
}
