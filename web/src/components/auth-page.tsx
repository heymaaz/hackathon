import { useState, type FormEvent } from "react"
import { RiBowlLine } from "@remixicon/react"

import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function AuthPage({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)
    const fd = new FormData(e.currentTarget)
    const email = String(fd.get("email") ?? "")
    const password = String(fd.get("password") ?? "")
    const name = String(fd.get("name") ?? "")
    const res =
      mode === "sign-up"
        ? await authClient.signUp.email({ name, email, password })
        : await authClient.signIn.email({ email, password })
    setPending(false)
    if (res.error) {
      setError(res.error.message ?? "Something went wrong")
      return
    }
    onSignedIn()
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <RiBowlLine aria-hidden="true" />
          </div>
          <CardTitle className="font-heading text-2xl">Recipebox</CardTitle>
          <CardDescription>Save the recipes you find. Cook the ones you're asked for.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <TabsList className="w-full">
              <TabsTrigger value="sign-in" className="flex-1">
                Sign in
              </TabsTrigger>
              <TabsTrigger value="sign-up" className="flex-1">
                Create account
              </TabsTrigger>
            </TabsList>
            <TabsContent value="sign-in">
              <AuthForm mode="sign-in" pending={pending} error={error} onSubmit={submit} />
            </TabsContent>
            <TabsContent value="sign-up">
              <AuthForm mode="sign-up" pending={pending} error={error} onSubmit={submit} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}

function AuthForm({
  mode,
  pending,
  error,
  onSubmit,
}: {
  mode: "sign-in" | "sign-up"
  pending: boolean
  error: string | null
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <form onSubmit={onSubmit} className="pt-4">
      <FieldGroup>
        {mode === "sign-up" && (
          <Field>
            <FieldLabel htmlFor={`${mode}-name`}>Name</FieldLabel>
            <Input id={`${mode}-name`} name="name" placeholder="What should we call you?" required autoComplete="name" />
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor={`${mode}-email`}>Email</FieldLabel>
          <Input id={`${mode}-email`} name="email" type="email" required autoComplete="email" />
        </Field>
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor={`${mode}-password`}>Password</FieldLabel>
          <Input
            id={`${mode}-password`}
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            aria-invalid={error ? true : undefined}
          />
          {mode === "sign-up" && <FieldDescription>At least 8 characters.</FieldDescription>}
          {error && <FieldError>{error}</FieldError>}
        </Field>
        <Button type="submit" disabled={pending} className="w-full">
          {pending && <Spinner data-icon="inline-start" />}
          {mode === "sign-up" ? "Create account" : "Sign in"}
        </Button>
      </FieldGroup>
    </form>
  )
}
