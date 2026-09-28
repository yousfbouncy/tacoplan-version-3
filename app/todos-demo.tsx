import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, FlatList, Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import Colors from "@/constants/colors";

type Todo = { id: number; name: string };

export default function TodosDemoScreen() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.from("todos").select();
        if (error) throw error;
        setTodos((data as Todo[]) || []);
      } catch (e: any) {
        setError(e.message || "Error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <View style={{ flex: 1, paddingTop: Platform.OS === "web" ? 90 : 50, alignItems: "center", backgroundColor: Colors.light.background }}>
      <Text style={{ fontSize: 18, fontWeight: "700", color: Colors.light.text, marginBottom: 8 }}>Todo List</Text>
      {loading ? (
        <ActivityIndicator color={Colors.light.tint} />
      ) : error ? (
        <Text style={{ color: Colors.light.danger }}>{error}</Text>
      ) : (
        <FlatList
          data={todos}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <Text style={{ color: Colors.light.text, paddingVertical: 6 }}>{item.name}</Text>}
        />
      )}
    </View>
  );
}

