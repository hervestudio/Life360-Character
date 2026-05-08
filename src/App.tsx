import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import AdminPage from "@/pages/AdminPage"
import ClientPage from "@/pages/ClientPage"

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ClientPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
