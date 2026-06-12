'use client'

/**
 * SettingsForm — client component for /settings (D-05).
 *
 * Two cards:
 * 1. "Clave API de Anthropic" — shows masked key, Actualizar / Desconectar buttons
 * 2. "Tope de respuestas AI" — numeric input for api_response_cap (D-06)
 *
 * D-07: If has_api_key is false, shows a callout linking to /onboarding/api-key.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ApiKeyForm } from '@/components/byok/api-key-form'
import { apiFetch } from '@/lib/api'
import type { CreatorSettings } from '@panelito/types'

interface SettingsFormProps {
  settings: CreatorSettings
  last4?: string | null
}

export function SettingsForm({ settings, last4 }: SettingsFormProps) {
  const router = useRouter()
  const [cap, setCap] = useState<number>(settings.api_response_cap)
  const [capSaving, setCapSaving] = useState(false)
  const [capError, setCapError] = useState<string | null>(null)
  const [capSaved, setCapSaved] = useState(false)
  const [keyDialogOpen, setKeyDialogOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const maskedKey = settings.has_api_key
    ? `sk-ant-••••••••${last4 ?? ''}`
    : null

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await apiFetch('/api/keys', { method: 'DELETE' })
      router.refresh()
    } catch {
      // Silently refresh on error — user will see updated state
      router.refresh()
    } finally {
      setDisconnecting(false)
    }
  }

  const handleSaveCap = async () => {
    setCapError(null)
    setCapSaved(false)
    if (cap < 1 || cap > 10000 || !Number.isInteger(cap)) {
      setCapError('El tope debe ser un entero entre 1 y 10000.')
      return
    }
    setCapSaving(true)
    try {
      await apiFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ api_response_cap: cap }),
      })
      setCapSaved(true)
      router.refresh()
    } catch {
      setCapError('Error al guardar. Intenta de nuevo.')
    } finally {
      setCapSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Card 1: API Key */}
      <Card>
        <CardHeader>
          <CardTitle className="text-[16px]">Clave API de Anthropic</CardTitle>
        </CardHeader>
        <CardContent>
          {settings.has_api_key ? (
            <div className="space-y-4">
              {/* Masked key display */}
              <div className="flex items-center gap-3">
                <code className="text-[13px] font-mono bg-muted px-2 py-1 rounded">
                  {maskedKey}
                </code>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-3">
                {/* Actualizar: opens modal with ApiKeyForm */}
                <Dialog open={keyDialogOpen} onOpenChange={setKeyDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="h-9">
                      Actualizar clave
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-[480px]">
                    <DialogHeader>
                      <DialogTitle>Actualizar clave API</DialogTitle>
                      <DialogDescription>
                        Ingresa tu nueva clave de Anthropic. La clave anterior
                        sera reemplazada.
                      </DialogDescription>
                    </DialogHeader>
                    <ApiKeyForm />
                  </DialogContent>
                </Dialog>

                {/* Desconectar: AlertDialog confirmation */}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" className="h-9" disabled={disconnecting}>
                      Desconectar
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Desconectar clave API</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esto eliminara tu clave API. Necesitaras volver a
                        conectarla para usar el AI en sesiones futuras.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDisconnect}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Desconectar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-muted-foreground/40 p-4 text-center">
              <p className="text-[14px] text-muted-foreground">
                No tienes una clave API conectada.{' '}
                <Link
                  href="/onboarding/api-key"
                  className="text-primary underline underline-offset-2"
                >
                  Conecta tu clave
                </Link>{' '}
                para habilitar el AI en sesiones.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Card 2: AI Response Cap (D-06) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-[16px]">
            Tope de respuestas AI por sesion
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <p className="text-[13px] text-muted-foreground">
              Limite global de respuestas AI por sesion (1–10,000). Por defecto: 150.
            </p>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={1}
                max={10000}
                value={cap}
                onChange={(e) => {
                  setCap(parseInt(e.target.value, 10) || 0)
                  setCapSaved(false)
                }}
                className="w-20 h-9"
              />
              <Button
                onClick={handleSaveCap}
                disabled={capSaving}
                variant="outline"
                className="h-9"
              >
                {capSaving ? 'Guardando...' : 'Guardar'}
              </Button>
              {capSaved && (
                <span className="text-[13px] text-muted-foreground">Guardado</span>
              )}
            </div>
            {capError && (
              <p className="text-[13px] text-destructive" role="alert">
                {capError}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
